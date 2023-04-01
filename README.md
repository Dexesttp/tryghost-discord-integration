# Ghost Website and Discord integration

## Purpose

This project intends to allow bridging a self-hosted website that uses [Ghost](https://github.com/TryGhost/Ghost) and a Discord server (guild).

The goal is to automatically assign a Discord role to Ghost members, based on their active subscription.

## Important Disclaimer

**IMPORTANT!!!**

This is a proof of concept and work in progress that has not been tested, cleaned up, or secured in a lot of ways.

If you install this on your Ghost website, this might:
- Create security issues, which can lead to ways for **attackers to take over your website**
- Create accidental bugs that can impact your database, including **wiping out all of your subscribed, paying members**

More extensive testing, review, and clean up is needed to be confident, after which we will be able to say that a best effort has been made to prevent the two above from happening. But, for now, this notice is there to notify you that this might not be a good idea.

## Overview

This project is made of four distinct parts:
- A Discord bot
- A Ghost API for users to link their Discord account
- A Ghost admin panel & associated API to manage roles and associations 
- An automatic installer (work in progress)

## Current progress

- [X] Integrate Ghost members and Discord accounts
- [X] Add a Discord bot management screen for admins
- [X] Add a role management screen for admins
- [X] Make the Ghost to Discord integration screen integrated in the Ghost website directly
- [ ] Prettify the admin screen
- [ ] Write the script to automatically install everything

## How to set it up

The set up process is currently quite involved, since the setup script has not been written. However, this workflow should help with the setup script down the line.

1. Install Ghost - see [the install instructions](https://ghost.org/docs/install/ubuntu/) for details about that.
2. Download this repository's contents (or at least the `index.js`, `discord-integration-plugin.js` and `package.json` files) in a folder on your server
  - The best place is probably in `/var/www/`, next to the other Ghost things you added there (for example, `/var/www/ghost-discord-integration`)
3. Run `npm install` in this folder
4. Set up an `.env` file in this folder, following the example of `env.example`
  - The `GHOST_URL` is your website's base URL
  - The `GHOST_CONTENT_TOKEN` and `GHOST_ADMIN_TOKEN` should be created through the Ghost settings, under integration (click on "add custom integration" at the very botton)
  - The `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD` and `DATABASE_NAME` should match what you set up while deploying Ghost. You can find them in the `/var/www/<your website>/config.production.json` file.
5. Create a systemd script
  - Go to `/lib/systemd/system/`
  - Run `sudo cp ghost_[TAB] ghost_discord-integration.service`
  - Edit the new `ghost_discord-integration.service` (for example, with `sudo nano ghost_discord-integration.service`)
  - Replace the `WorkingDirectory` line with `WorkingDirectory=/var/www/ghost-discord-integration`
  - Replace the `ExecStart` line with `ExecStart=/usr/bin/node index.js`
6. Start (and autostart) the systemd script with `sudo systemd start ghost_discord-integration.service` and then `sudo systemd enable ghost_discord-integration.service`
7. Edit the `/etc/nginx/sites-available/<your website name>-ssl.conf` nginx config
  - We recommend making a backup first (`sudo cp /etc/nginx/sites-available/<your website name>-ssl.conf /etc/nginx/sites-available/<your website name>-ssl.conf.bak`)
  - Don't forget to `sudo nano` it
  - Add the following two things:
    ```nginx
    location /ghost/discord {
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Host $http_host;
        proxy_pass http://localhost:19234/ghost/discord;
    }
    location /discord {
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Host $http_host;
        proxy_pass http://localhost:19234/discord;
    }
    ```
  - Don't forget to restart nginx once you're done with `sudo systemctl restart nginx.service`.
8. Create a Discord application in the [Discord developer portal](https://discord.com/developers/applications)
9. Add the redirect in your Discord application
  - In the OAuth2 panel, under "Redirects", add `<your-website>/discord/auth/callback`
10. Note down a few things about your Discord application
  - In the OAuth2 panel, note your `client ID` and `client secret` (you will need to click on "reset secret" to see it)
  - In the "Bot" panel, note down your `token` (you will need to click on "reset token" to see it)
11. Go to `https://<your-website>/ghost/discord` (if you're redirected to log in, log in then go there again) to fill in the details of the `token`, `client ID` and `client secret`
  - You will need to click on "Bot Status" to show additional details
  - Click on `Send new secrets` once you're done
  - Check that the Bot Status is now shown as `Online`. If not, then you have an issue with your token, ID or secret.
12. Invite your Bot to your guild
  - This is a bit of an involved process with oauth, you need to generate a custom link and things like that. This is described in [the Bot Authorization Flow in the developer docs](https://discord.com/developers/docs/topics/oauth2#bot-authorization-flow), with the code `268435456` for managing roles. Ultimately, this should be shown on the website directly.
13. Enter the guild ID where you want your bot to be active in `guild ID`, then click on "Update Guild ID"
14. Set up your roles
  - Click on "Re-request the list of roles from the guild" to see the roles available on Discord
  - Click on "Handle role" to make the bot responsible for the role
  - Click on "Associate more tiers" then select the tier you want for the role
15. Click on "Re-apply all roles to users" to force the bot to run
  - The bot will auto-run whenever an user connects or disconnects themselves to the bot
  - You need to add hooks for users changing membership
16. Set up the hooks of the discord integration
  - Go back to your Ghost settings, and to your created integration
  - Add the `Member added` event to `http://localhost:19234/members/added`
  - Add the `Member deleted` event to `http://localhost:19234/members/removed`
  - Add the `Member updated` event to `http://localhost:19234/members/updated`
17. Set up the script injection for the members screen
  - Go back to your Ghost settings, under the code injection section
  - Add the following lines to the "Site Footer" section:
    ```html
    <script type="application/javascript" src="/discord/discord-integration-plugin.js"></script>
    ```
18. That's it! The website is now completely ready!

## License

This software is provided under the MIT license - see [the LICENSE file](./LICENSE) for details.
