# Administrator setup

## Create the admin account

1. The registered profile for ID `778598281` belongs to **Polycup Momanyi Mariera**. Its Supabase Auth sign-in email is `poycarpmomanyi80@gmail.com` (note the spelling). Sign in with the Auth email registered in Supabase.
2. After registration, run the following in that project's Supabase SQL Editor. It only promotes an account when both the email and profile ID number match:

   ```sql
   insert into public.admin_users (user_id, admin_user)
   select u.id, 1
   from auth.users u
   join public.profiles p on p.id = u.id
   where lower(u.email) = 'poycarpmomanyi80@gmail.com'
     and p.id_no = '778598281'
   on conflict (user_id, admin_user) do nothing;
   ```

3. Verify the promotion:

   ```sql
   select u.email, p.first_name, p.second_name, p.last_name, p.id_no
   from auth.users u
   join public.profiles p on p.id = u.id
   join public.admin_users au on au.user_id = u.id
   where lower(u.email) = 'poycarpmomanyi80@gmail.com'
     and p.id_no = '778598281';
   ```

   The registered profile has already been promoted in the linked project. This query is here for future setup; if it returns no rows, check that the Auth email and ID match the account in this project.

4. The administrator signs into the app with that account. It will show the **Reply to report** control on the community wall. Replies are saved in `public.report_messages` and displayed with the reports.

To change the account's Supabase Auth sign-in email, sign in to the app and choose **Change sign-in email** in the navigation. Enter the new address and follow Supabase's email-confirmation instructions. This updates the existing Auth user, keeping its profile, ID number, and admin role linked. The report-notification recipient is configured separately from the sign-in email.

For an existing Supabase database, run [`migrate_report_gps_coordinates.sql`](./migrate_report_gps_coordinates.sql) and [`migrate_report_messages.sql`](./migrate_report_messages.sql) in the SQL Editor first. The GPS migration requires coordinates on every new report but leaves existing reports unchanged. To save replies made by replying directly to notification emails, also run [`migrate_report_email_replies.sql`](./migrate_report_email_replies.sql). For a new database, run [`supabase_schema.sql`](./supabase_schema.sql).

## Enable report email notifications

The app sends a notification after it has saved a report and its attachments. Email is sent by the `report-notification` Edge Function through Resend; no email provider key or administrator email is placed in the web or Android app. The function defaults to the registered Supabase Auth email, `poycarpmomanyi80@gmail.com`; the `REPORT_ADMIN_EMAIL` secret can override the recipient.

The Supabase project must contain the exact secret names shown below. A custom secret with another name does not configure Resend.

1. Create or sign in to your Resend account and open **Domains**.
2. Add a domain you own (for example, `yourdomain.com`) and follow Resend's instructions to add its DNS records at your domain provider. Wait until Resend shows the domain as verified. You need access to the domain's DNS settings; use a sender address on that verified domain.
3. In Resend, create an API key with permission to send email. Keep it private; do not put it in the app, commit it, or send it in chat.
4. In a terminal in the project folder, set the verified sender and API key as Supabase function secrets:

   ```powershell
   npx supabase@latest secrets set --project-ref lcvymcpgbpeuexeosocv REPORT_FROM_EMAIL="Community Reports <reports@yourdomain.com>" RESEND_API_KEY=re_your_actual_key REPORT_ADMIN_EMAIL="poycarpmomanyi80@gmail.com" REPORT_ADMIN_REPLY_EMAIL="poycarpmomanyi80@gmail.com"
   ```

   Replace `yourdomain.com` with the verified domain and `re_your_actual_key` with the API key from Resend. This command sends the secrets directly to Supabase; the key is not stored in the repository.
5. For direct email replies, set up inbound receiving in Resend using either its provided `resend.app` receiving domain or a verified receiving subdomain. A custom domain needs the MX record Resend provides; use a subdomain if your domain already receives normal email. Create an `email.received` webhook pointing to:

   `https://lcvymcpgbpeuexeosocv.supabase.co/functions/v1/report-email-reply`

   Subscribe the webhook to `email.received`, then copy its signing secret from Resend. Set the following additional Supabase function secrets:

   ```powershell
   npx supabase@latest secrets set --project-ref lcvymcpgbpeuexeosocv REPORT_REPLY_DOMAIN="your-resend-receiving-domain" RESEND_WEBHOOK_SECRET="whsec_your_webhook_signing_secret"
   ```

   Replace the receiving domain and signing secret with the values in Resend. `REPORT_ADMIN_REPLY_EMAIL` must be the exact mailbox address the admin will reply from; it defaults to `poycarpmomanyi80@gmail.com`.
6. Deploy both functions after configuring the secrets:

   ```powershell
   npx supabase@latest functions deploy report-notification --project-ref lcvymcpgbpeuexeosocv
   npx supabase@latest functions deploy report-email-reply --project-ref lcvymcpgbpeuexeosocv
   ```

New reports will email `poycarpmomanyi80@gmail.com` and use a report-specific Reply-To address. The admin can reply to that notification email; Resend verifies the webhook and sender, then stores the reply in `public.report_messages` on the matching report wall. Until inbound receiving, the webhook, and these secrets are configured, use the app's **Reply to report** control instead. If notification delivery fails, the report remains saved and the wall displays a warning rather than inviting the resident to submit the report again.

Test with a new report after setup: confirm `poycarpmomanyi80@gmail.com` receives the notification, reply to it from that email account, then open the report wall and verify the reply appears on the same report. Older reports are not retroactively emailed.

## Build the Android app

From `android-app`, `npm run build:apk` creates a **debug-only** APK for development/testing. Do not distribute that APK.

```powershell
npm run build:apk
```

### Create a signed release

For distribution, create an upload keystore outside the project folder and keep a secure backup of it. Never commit or share the keystore or its passwords. Use the same keystore for future APK updates; losing it may prevent updating an app distributed outside Google Play.

In PowerShell, create the directory and keystore; `keytool` prompts for the passwords instead of putting them in the command:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\android-signing"
keytool -genkeypair -v -keystore "$env:USERPROFILE\android-signing\community-reporting-upload.jks" -keyalg RSA -keysize 3072 -validity 10000 -alias upload
```

Set the signing values in that same terminal before running a release build. Enter passwords at the hidden prompts:

- `ANDROID_UPLOAD_KEYSTORE`: absolute path to the upload keystore
- `ANDROID_UPLOAD_STORE_PASSWORD`: keystore password
- `ANDROID_UPLOAD_KEY_ALIAS`: key alias
- `ANDROID_UPLOAD_KEY_PASSWORD`: key password

```powershell
$env:ANDROID_UPLOAD_KEYSTORE = "$env:USERPROFILE\android-signing\community-reporting-upload.jks"
$env:ANDROID_UPLOAD_KEY_ALIAS = "upload"
$storePassword = Read-Host "Keystore password" -AsSecureString
$env:ANDROID_UPLOAD_STORE_PASSWORD = (New-Object System.Net.NetworkCredential("", $storePassword)).Password
$keyPassword = Read-Host "Key password" -AsSecureString
$env:ANDROID_UPLOAD_KEY_PASSWORD = (New-Object System.Net.NetworkCredential("", $keyPassword)).Password
```

The release commands stop if any value is missing or the keystore path is invalid. From `android-app`, build a signed APK for direct testing/install:

```powershell
npm run build:release-apk
```

Or build a signed Android App Bundle for Google Play submission:

```powershell
npm run build:release-bundle
```

The release APK is written to `android-app/android/app/build/outputs/apk/release/app-release.apk`; the bundle is written to `android-app/android/app/build/outputs/bundle/release/app-release.aab`. Increment `versionCode` in `android-app/android/app/build.gradle` for each update.

For the best user trust and fewer installation warnings, publish the signed bundle through Google Play and use Play App Signing. A signed APK installed directly may still show an unknown-source or Play Protect warning until distribution reputation is established. No build setting can guarantee that antivirus or Play Protect will never warn; if a warning identifies this app, verify the release artifact and submit it to the relevant vendor for review rather than disabling or bypassing protection.

After building, clear the signing values from the terminal:

```powershell
Remove-Item Env:ANDROID_UPLOAD_KEYSTORE, Env:ANDROID_UPLOAD_STORE_PASSWORD, Env:ANDROID_UPLOAD_KEY_ALIAS, Env:ANDROID_UPLOAD_KEY_PASSWORD
Remove-Variable storePassword, keyPassword
```
