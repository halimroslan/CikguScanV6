# Security Spec

1. Data Invariants:
- A user document's `userId` must strictly match the `request.auth.uid`.
- Users cannot set `isPro` to `true` or alter `proExpireAt` on creation or update (unless they are admin, but wait, the client is trying to do that!).

Wait, let's look at `/src/main.ts` again!
`await setDoc(userRef, { isPro: true, proExpireAt: null, lastLogin: Timestamp.now() }, { merge: true });`
This is called in the client for `abdulhalimroslan@gmail.com`:
```typescript
if (user.email === 'abdulhalimroslan@gmail.com') {
    isPro = true;
    await setDoc(userRef, { isPro: true, proExpireAt: null, lastLogin: Timestamp.now() }, { merge: true });
}
```
Oh! The client is writing `isPro: true`. Is this safe? If the rule prevents users from making themselves Pro, it will reject this write.
Wait, if `abdulhalimroslan@gmail.com` is essentially the admin, the rules should check:
```javascript
function isAdmin() {
  return request.auth.token.email == 'abdulhalimroslan@gmail.com' && request.auth.token.email_verified == true;
}
```
For regular users, they can only create themselves with `isPro: false`.

Let's specify the rules accurately.
