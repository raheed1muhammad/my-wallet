# My Wallet

Personal income and expense ledger (OMR / INR): entries, SIP, loans, recurring, plan, analysis, exchange rates.

## For users
- Installable web app. Open the site on a phone and choose "Add to Home Screen".
- You log in with your own email and password. New accounts also need the sign-up code from the owner.
- Your data is saved in your own private space in the cloud (Firebase). Other users cannot see it.
  It is also kept on your device, so you can view and add entries without internet; they sync when you are back online.
- Keep a copy of your data: the Tools page, card "Data backup & restore", has JSON backup, Export / Import everything, and CSV.
  The Ledger can also download CSV files. Do not share backup files; they hold your private data.
- Changing accounts, your name or country needs internet. Entries do not.

## For the owner
Nothing personal and no secrets are stored in this repository. Keep it that way.

- **Sign-up code:** lives only in the Firebase console (Firestore, collection `config`, document `signup`, field `code`).
  Never write it in the code or here. Use a long random code. Change it whenever you like; people already invited stay in.
- **Database rules:** `firestore.rules` is the reference copy. Changing this file does NOT change the live rules.
  Paste the new text in the Firebase console (Firestore, Rules) and press Publish. Keep the old text to go back.
- **Firebase web key** (`cloud.js`) is public by design. It is restricted in Google Cloud to this site's addresses
  (`raheed1muhammad.github.io`, `my-wallet-d0163.firebaseapp.com`, `my-wallet-d0163.web.app`). If the site moves, update that list.
- **Before every push:** run `node tools/release-check.js`. It checks the code for syntax mistakes, runs the tests in
  `tests/run.js` (money balances, backup restore, CSV, saving, accounts), looks for secrets, and makes sure the cache number
  in `sw.js` (`const C='mywallet-vNN'`) was raised, otherwise phones keep the old version.
  `node tools/release-check.js --bump` raises the number for you. Do not push if it says NOT READY.
- **Going live:** the site is published with GitHub Pages (check the branch in the repository Settings, Pages; it is `main`
  if pushes to `main` show up on the site). Work on another branch, test, and merge only when ready.
- **Going back:** `git revert` the bad commit, or check out an older commit and push it. Data is not touched by code changes.
- **Rate API key** (optional, for the Exchange page) is stored in each user's private account space, never in the code.
