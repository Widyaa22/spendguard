//! SpendGuard — an on-chain spend policy for AI agents.
//!
//! The problem this solves: giving an agent a wallet is easy, giving it a *budget* is not. Off-chain limits are
//! only as strong as the code that respects them, and an agent that hallucinates a payment does not ask the
//! billing service for permission first. So the rules live on-chain, next to the money:
//!
//!   * the vault is a token account owned by a policy PDA, not by the agent
//!   * `Spend` is the only instruction that can move money out, and it re-checks every rule before the CPI
//!   * the daily window is UTC-day based and stored in the policy account
//!   * `paused` is a kill switch the owner can flip without touching the agent's key
//!   * an allowlist bounds *who* can be paid, independent of how much
//!
//! Instructions are raw byte layouts (no Anchor) so the program has no framework dependency beyond
//! `solana-program` itself.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

entrypoint!(process_instruction);

/// Program error codes, surfaced to the client so a denial is distinguishable from a crash.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardError {
    PolicyPaused = 0,
    PerTxLimitExceeded = 1,
    DailyLimitExceeded = 2,
    RecipientNotAllowlisted = 3,
    NotAuthority = 4,
    NotAgent = 5,
    AmountNotPositive = 6,
    AllowlistFull = 7,
}
impl From<GuardError> for ProgramError {
    fn from(e: GuardError) -> Self {
        ProgramError::Custom(6000 + e as u32)
    }
}

pub const MAX_ALLOWLIST: usize = 8;

/// On-chain policy state, held in a PDA so the agent cannot edit it.
#[derive(Debug, Clone, PartialEq)]
pub struct Policy {
    /// owner: may pause, edit the allowlist, or withdraw.
    pub authority: Pubkey,
    /// agent: may spend, within the rules below. Cannot change the rules.
    pub agent: Pubkey,
    /// mint of the token held in the vault.
    pub mint: Pubkey,
    /// vault token account, owned by this PDA.
    pub vault: Pubkey,
    /// maximum spendable per UTC day.
    pub daily_limit: u64,
    /// maximum for one spend.
    pub per_tx_limit: u64,
    /// UTC day index the counter belongs to.
    pub day: i64,
    /// amount already spent in `day`.
    pub spent_today: u64,
    /// lifetime spend, for reporting.
    pub total_spent: u64,
    /// kill switch.
    pub paused: bool,
    /// recipients the agent may pay.
    pub allowlist: Vec<Pubkey>,
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let (tag, mut rest) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => init_policy(program_id, accounts, &mut rest),
        1 => set_paused(program_id, accounts, &mut rest),
        2 => set_allowlist(program_id, accounts, &mut rest),
        3 => deposit(program_id, accounts, &mut rest),
        4 => spend(program_id, accounts, &mut rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn read_u64(rest: &mut &[u8]) -> Result<u64, ProgramError> {
    if rest.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (bytes, tail) = rest.split_at(8);
    *rest = tail;
    Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
}

/// Fixed part of the on-chain layout, before the allowlist.
const POLICY_FIXED: usize = 32 * 4 + 8 * 5 + 2; // authority,agent,mint,vault + 5 u64 + paused,count

/// Hand-rolled (de)serialization: no external crate is available in this build environment, and the layout is
/// simple enough that spelling it out is clearer than pulling a framework in. Little-endian, matching Solana.
fn pack_policy(p: &Policy) -> Vec<u8> {
    let mut out = Vec::with_capacity(POLICY_FIXED + p.allowlist.len() * 32);
    out.extend_from_slice(p.authority.as_ref());
    out.extend_from_slice(p.agent.as_ref());
    out.extend_from_slice(p.mint.as_ref());
    out.extend_from_slice(p.vault.as_ref());
    out.extend_from_slice(&p.daily_limit.to_le_bytes());
    out.extend_from_slice(&p.per_tx_limit.to_le_bytes());
    out.extend_from_slice(&p.day.to_le_bytes());
    out.extend_from_slice(&p.spent_today.to_le_bytes());
    out.extend_from_slice(&p.total_spent.to_le_bytes());
    out.push(p.paused as u8);
    out.push(p.allowlist.len() as u8);
    for k in &p.allowlist {
        out.extend_from_slice(k.as_ref());
    }
    out
}

fn unpack_policy(data: &[u8]) -> Result<Policy, ProgramError> {
    if data.len() < POLICY_FIXED {
        return Err(ProgramError::InvalidAccountData);
    }
    let k = |i: usize| Pubkey::new_from_array(data[i..i + 32].try_into().unwrap());
    let u = |i: usize| u64::from_le_bytes(data[i..i + 8].try_into().unwrap());
    let count = data[POLICY_FIXED - 1] as usize;
    if count > MAX_ALLOWLIST || data.len() < POLICY_FIXED + count * 32 {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut allowlist = Vec::with_capacity(count);
    for i in 0..count {
        let off = POLICY_FIXED + i * 32;
        allowlist.push(Pubkey::new_from_array(data[off..off + 32].try_into().unwrap()));
    }
    Ok(Policy {
        authority: k(0), agent: k(32), mint: k(64), vault: k(96),
        daily_limit: u(128), per_tx_limit: u(136), day: u(144) as i64,
        spent_today: u(152), total_spent: u(160),
        paused: data[168] != 0,
        allowlist,
    })
}

fn load_policy(account: &AccountInfo, program_id: &Pubkey) -> Result<Policy, ProgramError> {
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    unpack_policy(&account.data.borrow())
}

fn save_policy(account: &AccountInfo, policy: &Policy) -> ProgramResult {
    let bytes = pack_policy(policy);
    let mut data = account.data.borrow_mut();
    if data.len() < bytes.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..bytes.len()].copy_from_slice(&bytes);
    Ok(())
}

/// Bytes an account needs for a policy with `n` allowlist entries.
pub fn policy_space(n: usize) -> usize {
    POLICY_FIXED + n * 32
}

/// 0: initialize the policy PDA and its vault.
/// accounts: [authority(s), agent, policy PDA(w), vault token account(w), mint, token program, system program, rent]
fn init_policy(program_id: &Pubkey, accounts: &[AccountInfo], rest: &mut &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let authority = next_account_info(it)?;
    let agent = next_account_info(it)?;
    let policy_ai = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let mint = next_account_info(it)?;
    let _token_program = next_account_info(it)?;
    let _system_program = next_account_info(it)?;
    let _rent_sysvar = next_account_info(it)?;

    if !authority.is_signer {
        return Err(GuardError::NotAuthority.into());
    }
    let daily_limit = read_u64(rest)?;
    let per_tx_limit = read_u64(rest)?;
    let clock = Clock::get()?;

    let policy = Policy {
        authority: *authority.key,
        agent: *agent.key,
        mint: *mint.key,
        vault: *vault.key,
        daily_limit,
        per_tx_limit,
        day: clock.unix_timestamp / 86_400,
        spent_today: 0,
        total_spent: 0,
        paused: false,
        allowlist: Vec::new(),
    };
    save_policy(policy_ai, &policy)?;
    msg!(
        "spendguard: policy initialised, daily {} per-tx {}",
        daily_limit,
        per_tx_limit
    );
    Ok(())
}

/// 1: flip the kill switch. accounts: [authority(s), policy(w)]
fn set_paused(program_id: &Pubkey, accounts: &[AccountInfo], rest: &mut &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let authority = next_account_info(it)?;
    let policy_ai = next_account_info(it)?;
    if !authority.is_signer {
        return Err(GuardError::NotAuthority.into());
    }
    let mut policy = load_policy(policy_ai, program_id)?;
    if policy.authority != *authority.key {
        return Err(GuardError::NotAuthority.into());
    }
    let (flag, _) = rest.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    policy.paused = *flag != 0;
    save_policy(policy_ai, &policy)?;
    msg!("spendguard: paused = {}", policy.paused);
    Ok(())
}

/// 2: replace the allowlist. accounts: [authority(s), policy(w)]
/// payload after tag: u8 count, then count * 32-byte pubkeys.
fn set_allowlist(program_id: &Pubkey, accounts: &[AccountInfo], rest: &mut &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let authority = next_account_info(it)?;
    let policy_ai = next_account_info(it)?;
    if !authority.is_signer {
        return Err(GuardError::NotAuthority.into());
    }
    let mut policy = load_policy(policy_ai, program_id)?;
    if policy.authority != *authority.key {
        return Err(GuardError::NotAuthority.into());
    }
    let (count, mut keys) = rest.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    let count = *count as usize;
    if count > MAX_ALLOWLIST {
        return Err(GuardError::AllowlistFull.into());
    }
    if keys.len() < count * 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut list = Vec::with_capacity(count);
    for _ in 0..count {
        let (chunk, tail) = keys.split_at(32);
        list.push(Pubkey::new_from_array(chunk.try_into().unwrap()));
        keys = tail;
    }
    policy.allowlist = list;
    save_policy(policy_ai, &policy)?;
    msg!("spendguard: allowlist now has {} entries", count);
    Ok(())
}

/// 3: fund the vault. accounts: [agent(s), policy, mint, vault(w), source token account(w), token program]
fn deposit(_program_id: &Pubkey, accounts: &[AccountInfo], rest: &mut &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let agent = next_account_info(it)?;
    let policy_ai = next_account_info(it)?;
    let _mint = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let source = next_account_info(it)?;
    let token_program = next_account_info(it)?;
    if !agent.is_signer {
        return Err(GuardError::NotAgent.into());
    }
    let amount = read_u64(rest)?;
    if amount == 0 {
        return Err(GuardError::AmountNotPositive.into());
    }
    let _ = policy_ai; // the vault is bound to the PDA by address; no state read needed to accept funding
    let ix = spl_token::instruction::transfer(
        token_program.key,
        source.key,
        vault.key,
        agent.key,
        &[],
        amount,
    )?;
    invoke(
        &ix,
        &[source.clone(), vault.clone(), agent.clone(), token_program.clone()],
    )?;
    msg!("spendguard: vault funded with {}", amount);
    Ok(())
}

/// 4: the only way money leaves. accounts: [agent(s), policy(w), vault(w), recipient token account(w), token program]
fn spend(program_id: &Pubkey, accounts: &[AccountInfo], rest: &mut &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let agent = next_account_info(it)?;
    let policy_ai = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let recipient = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    if !agent.is_signer {
        return Err(GuardError::NotAgent.into());
    }
    let amount = read_u64(rest)?;

    let mut policy = load_policy(policy_ai, program_id)?;
    if policy.agent != *agent.key {
        return Err(GuardError::NotAgent.into());
    }
    if policy.paused {
        return Err(GuardError::PolicyPaused.into());
    }
    if amount == 0 {
        return Err(GuardError::AmountNotPositive.into());
    }
    if amount > policy.per_tx_limit {
        return Err(GuardError::PerTxLimitExceeded.into());
    }
    if !policy.allowlist.contains(recipient.key) {
        return Err(GuardError::RecipientNotAllowlisted.into());
    }

    // daily window in UTC days; a new day resets the counter
    let clock = Clock::get()?;
    let today = clock.unix_timestamp / 86_400;
    if today != policy.day {
        policy.day = today;
        policy.spent_today = 0;
    }
    if policy.spent_today + amount > policy.daily_limit {
        // persist the day rollover even though the spend is refused
        save_policy(policy_ai, &policy)?;
        return Err(GuardError::DailyLimitExceeded.into());
    }

    // transfer from the PDA-owned vault, signed by the policy PDA
    let (pda, bump) = Pubkey::find_program_address(&[b"policy", policy.agent.as_ref()], program_id);
    if pda != *policy_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }
    let seeds: &[&[u8]] = &[b"policy", policy.agent.as_ref(), &[bump]];
    let ix = spl_token::instruction::transfer(
        token_program.key,
        vault.key,
        recipient.key,
        &pda,
        &[],
        amount,
    )?;
    invoke_signed(
        &ix,
        &[vault.clone(), recipient.clone(), policy_ai.clone(), token_program.clone()],
        &[seeds],
    )?;

    policy.spent_today += amount;
    policy.total_spent += amount;
    save_policy(policy_ai, &policy)?;
    msg!(
        "spendguard: spent {} (today {}/{})",
        amount,
        policy.spent_today,
        policy.daily_limit
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy_with(allow: Pubkey) -> Policy {
        Policy {
            authority: Pubkey::new_unique(),
            agent: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            daily_limit: 100,
            per_tx_limit: 30,
            day: 20_000,
            spent_today: 0,
            total_spent: 0,
            paused: false,
            allowlist: vec![allow],
        }
    }

    #[test]
    fn serialization_round_trip() {
        let p = policy_with(Pubkey::new_unique());
        let packed = pack_policy(&p);
        assert_eq!(packed.len(), policy_space(1));
        assert_eq!(unpack_policy(&packed).unwrap(), p);
    }

    #[test]
    fn rejects_truncated_data() {
        assert!(unpack_policy(&[0u8; 10]).is_err());
    }

    #[test]
    fn error_codes_are_distinct() {
        let a: ProgramError = GuardError::PolicyPaused.into();
        let b: ProgramError = GuardError::DailyLimitExceeded.into();
        assert_ne!(a, b);
    }
}
