// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
## Your account

Everyone can change their own password and preferences on **Staff → My Account** (or **My account** under your name, top right).

![Staff → My Account](staff-my-account)

Forgot your password? On the admin sign-in, type your email and click **Forgot your password?**, then follow the link in the email.

## Adding a staff member (owners)

1. Open **Staff → Add a Staff Member**.
2. Enter their name and email. Use an address that isn't already a customer account.
3. Leave the password blank to have one made up, then click **Add staff member**.
4. The sign-in details are shown **once**: click **Copy email and password** and send them privately.

They should change the password on their first sign-in.

## Managing staff (owners)

On **Staff List**: **Reset password**, **Make owner** / **Make staff**, and **Remove** (they're locked out at once). You can't remove yourself, and there's always at least one owner.

Owners can also add and remove staff, change Shop Settings, and delete things. Regular staff can add and edit, but not delete.

## Change Log (owners)

Every change staff make, with who made it and when.

![Staff → Change Log](staff-change-log)
`;
