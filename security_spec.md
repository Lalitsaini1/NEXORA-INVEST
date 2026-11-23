# NEXORA INVEST — Security Specification & Payload TDD

## 1. Data Invariants

1. **Zero Plaintext Credentials**: No document in `users`, `identityLocks`, or any other Firestore collection may store `password`, `passwordHash`, or raw secret tokens.
2. **Immutable Permanent NX User ID**: `users/{uid}.userId` must match `^NX[0-9]{6,10}$`, must be assigned atomically by advancing `counters/userIds` by `+1` in the same transaction (`existsAfter` / `getAfter`), and can never be chosen or updated by the user.
3. **Zero Self-Promotion & Protected Super Admin Hierarchy**:
   - `users/{uid}.role` must equal `'USER'` on creation and remain immutable for non-Super-Admin writes.
   - Only `SUPER_ADMIN` (`wZQCw7fXrWQCn5HqdSjS6RQHVyi1`) can create, promote, demote, edit, suspend, or remove `ADMIN` accounts in `adminUsers` and `users`.
   - Regular `ADMIN` accounts cannot modify, demote, suspend, or delete `SUPER_ADMIN` (`wZQCw7fXrWQCn5HqdSjS6RQHVyi1`) or other `ADMIN` accounts, and cannot write to `platformSettings`.
4. **Zero Duplicate Email / Mobile Registrations**: `identityLocks/{lockId}` enforces unique SHA-256 hashed email and mobile locks per account (`!exists(...)` on create, `allow list: if false` to prevent scraping).
5. **Zero-Initialized Coin Wallet**: `coinWallets/{uid}` is initialized atomically at zero balances; client non-admin wallet updates are strictly denied.
6. **PII Isolation**: User profiles (`email`, `mobile`, `fullName`) can only be read by `request.auth.uid == userId` or `isAdmin()`.
7. **Immutable Coin Transaction Ledger & Audit Logs**: `coinTransactions`, `adminActivityLogs`, and `userActivityLogs` are strictly append-only (`allow update, delete: if false`).
8. **Stage 3 Operational Modules**: `upiAccounts`, `productPlans`, `depositRequests`, `withdrawalRequests`, and `platformSettings` enforce typed schema validation, size bounds, and strict RBAC partitioning (`isAdmin()` vs `isSuperAdmin()`).
9. **SecurityConfig & Admin Login Monitoring**: `platformSettings/global` security authentication policies and audit log retention days are writable exclusively by `isSuperAdmin()`; `adminLoginAttempts` is append-only (`uid == request.auth.uid`, server `timestamp`) and readable exclusively by `isAdmin()`.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Target Path | Expected Result |
|---|---------------|-------------|-----------------|
| 1 | Plaintext password stored in profile | `/users/{uid}` | `PERMISSION_DENIED` (`hasOnly` rejects `password`) |
| 2 | Self-promotion to ADMIN or SUPER_ADMIN role | `/users/{uid}` (`role: "ADMIN"`) | `PERMISSION_DENIED` (`incoming().role == 'USER'`) |
| 3 | Lower-tier Admin attempts to demote/suspend Super Admin | `/users/wZQCw7fXrWQCn5HqdSjS6RQHVyi1` | `PERMISSION_DENIED` (`isSuperAdmin()` required & Super Admin role locked) |
| 4 | Lower-tier Admin attempts to edit adminUsers directory | `/adminUsers/{uid}` | `PERMISSION_DENIED` (`isSuperAdmin()` required) |
| 5 | Creating wallet with free coins | `/coinWallets/{uid}` (`availableCoins: 50000`) | `PERMISSION_DENIED` (`availableCoins == 0`) |
| 6 | Non-admin updating own wallet balance | `/coinWallets/{uid}` (`update availableCoins`) | `PERMISSION_DENIED` (`isAdmin()` required) |
| 7 | Overwriting another user's profile | `/users/{otherUid}` | `PERMISSION_DENIED` (`userId == request.auth.uid`) |
| 8 | Reading another user's PII | `/users/{otherUid}` (`get` / `list`) | `PERMISSION_DENIED` (owner or admin only) |
| 9 | Scraping identityLocks collection | `/identityLocks` (`list`) | `PERMISSION_DENIED` (`allow list: if false`) |
| 10 | Non-Super-Admin modifies platform security settings | `/platformSettings/{id}` | `PERMISSION_DENIED` (`isSuperAdmin()` required) |
| 11 | Modifying/deleting immutable admin audit log | `/adminActivityLogs/{logId}` | `PERMISSION_DENIED` (`allow update, delete: if false`) |
| 12 | Unverified email spoofing admin | `/users/{otherUid}` (`email_verified: false`) | `PERMISSION_DENIED` (`email_verified == true`) |
