//@ts-check

console.log("Loading modules...");

const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const Cookies = require("cookies");
const undici = require("undici");
const { Client, Events, GatewayIntentBits } = require("discord.js");
const ClientOAuth2 = require("client-oauth2");

/** @type {any} */
const ObjectID = require("bson-objectid");

/** @type {any} */
const GhostAdminAPI = require("@tryghost/admin-api");

/** @type {any} */
const Knex = require("knex");

console.log("Loading env config...");
dotenv.config();
const config = {
  database: {
    client: "mysql",
    connection: {
      host: process.env.DATABASE_HOST || "localhost",
      user: process.env.DATABASE_USER || "root",
      password: process.env.DATABASE_PASSWORD || "",
      database: process.env.DATABASE_NAME || "ghostwebsite_prod",
      charset: "utf8",
    },
  },
  tables: {
    users: "discord_integration_user_associations",
    roles: "discord_integration_roles",
    role_associations: "discord_integration_role_associations",
  },
  ghost: {
    url: process.env.GHOST_URL || "https://my.website.url",
    contentToken: process.env.GHOST_CONTENT_TOKEN || "",
    adminToken: process.env.GHOST_ADMIN_TOKEN || "",
  },
  discord: {
    token: "",
    clientId: "",
    clientSecret: "",
    guildId: "",
  },
  server: {
    port: 19234,
  },
};

// Connect to the database
/** @type {import("knex").Knex} */
console.log("Connecting to the database...");
const knex = Knex(config.database);
console.log("Database connection successful!");

/**
 * GENERAL INITIALIZATION
 */

async function reloadConfigFromDatabase() {
  /**
   * @param {string} group
   * @param {string} key
   * @returns {Promise<string | undefined>}
   */
  async function getSetting(group, key) {
    const data = await knex("settings")
      .select("value")
      .where("group", group)
      .where("key", key)
      .first();
    if (!data) return undefined;
    return data.value;
  }

  // Load Discord-specific information
  config.discord.token =
    (await getSetting("discord_integration", "token")) || config.discord.token;
  config.discord.clientId =
    (await getSetting("discord_integration", "client_id")) ||
    config.discord.clientId;
  config.discord.clientSecret =
    (await getSetting("discord_integration", "client_secret")) ||
    config.discord.clientSecret;
  config.discord.guildId =
    (await getSetting("discord_integration", "guild_id")) ||
    config.discord.guildId;
}

async function updateSetting(group, key, newValue) {
  const existing = await knex("settings")
    .where("group", group)
    .where("key", key)
    .select("value")
    .first();
  if (existing) {
    await knex("settings")
      .where("group", group)
      .where("key", key)
      .update("value", newValue);
  } else {
    await knex("settings").insert({
      id: ObjectID().toHexString(),
      group: group,
      key: key,
      value: newValue,
      type: "string",
      created_at: knex.raw("NOW()"),
      created_by: "0",
    });
  }
}

async function initializeDatabasesIfNeeded() {
  try {
    // await knex.schema.dropTable(config.table.users);
    const tableExists = await knex.schema.hasTable(config.tables.users);
    if (!tableExists) {
      console.log(
        `Could not find the ${config.tables.users} table in the database. Creating the table...`
      );
      await knex.schema.createTable(config.tables.users, (table) => {
        table.string("email");
        table.string("user_id");
        table.text("token");
        table.text("data");
      });
      await knex.schema.alterTable(config.tables.users, (table) => {
        table.index(["email"]);
      });
      await knex.schema.alterTable(config.tables.users, (table) => {
        table.unique(["email"]);
      });
      await knex.schema.alterTable(config.tables.users, (table) => {
        table.primary(["email"]);
      });
      console.log(
        `Successfully created the ${config.tables.users} table in the database.`
      );
    }
  } catch (e) {
    console.log(
      `Issue while creating the ${config.tables.users} table in the database:`,
      e
    );
  }

  try {
    // await knex.schema.dropTable(config.table.roles);
    const tableExists = await knex.schema.hasTable(config.tables.roles);
    if (!tableExists) {
      console.log(
        `Could not find the ${config.tables.roles} table in the database. Creating the table...`
      );
      await knex.schema.createTable(config.tables.roles, (table) => {
        table.string("discord_role_id");
        table.boolean("is_handled_by_bot");
        table.text("data");
      });
      await knex.schema.alterTable(config.tables.roles, (table) => {
        table.index(["discord_role_id"]);
      });
      await knex.schema.alterTable(config.tables.roles, (table) => {
        table.unique(["discord_role_id"]);
      });
      await knex.schema.alterTable(config.tables.roles, (table) => {
        table.primary(["discord_role_id"]);
      });
      console.log(
        `Successfully created the ${config.tables.roles} table in the database.`
      );
    }
  } catch (e) {
    console.log(
      `Issue while creating the ${config.tables.roles} table in the database:`,
      e
    );
  }

  try {
    // await knex.schema.dropTable(config.table.role_associations);
    const tableExists = await knex.schema.hasTable(
      config.tables.role_associations
    );
    if (!tableExists) {
      console.log(
        `Could not find the ${config.tables.role_associations} table in the database. Creating the table...`
      );
      await knex.schema.createTable(
        config.tables.role_associations,
        (table) => {
          // This can be found either in the "products" database (under "slug"), or in the "members" database (under "status")
          table.string("slug");
          table.string("discord_role_id");
        }
      );
      console.log(
        `Successfully created the ${config.tables.role_associations} table in the database.`
      );
    }
  } catch (e) {
    console.log(
      `Issue while creating the ${config.tables.role_associations} table in the database:`,
      e
    );
  }
}

/**
 * DISCORD BOT SETUP
 */

/** @type {Client | undefined} */
let botClient = undefined;
async function reloadBotClient() {
  if (botClient) {
    botClient.removeAllListeners();
    botClient.destroy();
  }
  try {
    botClient = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    });
    botClient.once(Events.ClientReady, (c) => {
      console.log("Discord Bot Ready! Refreshing the list of roles...");
      refreshRolesFromDiscord();
    });
    await botClient.login(config.discord.token);
  } catch (e) {
    botClient = undefined;
    console.log("Discord bot could not start: ", e);
  }
}

async function refreshRolesFromDiscord() {
  if (!botClient) return;
  const guild = await botClient.guilds.resolve(config.discord.guildId);
  if (!guild) return;
  const foundIDs = [];

  // Add or update roles based on Discord
  const guildRoles = await guild.roles.fetch();
  for (const role of guildRoles.values()) {
    const existing = await knex(config.tables.roles)
      .where("discord_role_id", role.id)
      .first();
    const roleData = {
      id: role.id,
      name: role.name,
      creationTimestamp: role.createdTimestamp,
      color: role.hexColor,
      emoji: role.unicodeEmoji,
    };
    foundIDs.push(role.id);
    if (existing) {
      await knex(config.tables.roles)
        .where("discord_role_id", role.id)
        .update("data", JSON.stringify(roleData));
    } else {
      await knex(config.tables.roles).insert({
        discord_role_id: role.id,
        is_handled_by_bot: false,
        data: JSON.stringify(roleData),
      });
    }
  }

  // Remove non-existing roles from the database.
  const existingRoles = await knex(config.tables.roles).select({
    id: "discord_role_id",
  });
  for (const role of existingRoles) {
    if (foundIDs.includes(role.id)) continue;
    await knex(config.tables.roles).where("discord_role_id", role.id).delete();
  }
}

let lastRefreshStatus = undefined;
async function refreshMemberRolesOnDiscord() {
  try {
    if (!botClient) {
      lastRefreshStatus = {
        result: "BotNotConnected",
        messages: ["The bot was not connected. No refresh"],
      };
      return;
    }
    console.log("Refreshing the user list...");
    const ghostAdminApi = new GhostAdminAPI({
      url: config.ghost.url,
      version: "v5.0",
      key: config.ghost.adminToken,
    });
    const rawGhostUserList = await ghostAdminApi.members.browse();
    const guild = await botClient.guilds.resolve(config.discord.guildId);
    if (!guild) {
      lastRefreshStatus = {
        result: "BotNotConnected",
        messages: ["The bot was not connected. No refresh"],
      };
      return;
    }

    const rolesFromDatabase = await knex(config.tables.roles).select({
      discord_role_id: "discord_role_id",
      is_handled_by_bot: "is_handled_by_bot",
    });
    const discordUserAssociationFromDatabase = await knex(
      config.tables.users
    ).select({
      email: "email",
      user_id: "user_id",
    });
    const slugToRoleAssociations = await knex(
      config.tables.role_associations
    ).select({
      slug: "slug",
      discord_role_id: "discord_role_id",
    });

    await guild.members.fetch();
    const ghostUsers = discordUserAssociationFromDatabase
      .map((userAssociationData) => {
        return {
          discord_user_id: userAssociationData.user_id,
          email: userAssociationData.email,
          ghost: rawGhostUserList.find(
            (u) => u.email === userAssociationData.email
          ),
        };
      })
      .filter((d) => !!d.ghost);

    const messages = [];
    const roles = await guild.roles.fetch();
    for (const role of roles.values()) {
      const matched = rolesFromDatabase.find(
        (a) => a.discord_role_id === role.id
      );
      if (!matched) continue;
      if (!matched.is_handled_by_bot) continue;
      messages.push(`Handling role ${role.name}...`);

      const slugs = slugToRoleAssociations
        .filter((s) => s.discord_role_id === role.id)
        .map((s) => s.slug);

      const ghostUsersForDiscordRole = ghostUsers.filter(
        (u) =>
          slugs.includes(u.ghost.status) ||
          u.ghost.subscriptions.some((s) =>
            s.tier.some((t) => slugs.includes(t.slug))
          )
      );

      // Remove existing members if needed
      let userCount = 0;
      const matchedEmails = [];
      for (const discordUser of role.members.values()) {
        const ghostUser = ghostUsersForDiscordRole.find(
          (u) => u.discord_user_id === discordUser.id
        );
        if (!ghostUser) {
          try {
            await discordUser.roles.remove(role);
            messages.push(
              `Role ${role.name} removed from user ${discordUser.user.username}#${discordUser.user.tag}`
            );
          } catch (e) {
            messages.push(
              `!!Warning!! Could not remove role ${role.name} from user ${
                discordUser.user.username
              }#${discordUser.user.tag} : ${JSON.stringify(e)}`
            );
          }
          continue;
        }
        matchedEmails.push(ghostUser.email);
        userCount++;
      }

      // Add new members if needed
      for (const ghostUser of ghostUsersForDiscordRole) {
        if (matchedEmails.includes(ghostUser.email)) continue;
        try {
          const discordUser = await guild.members.fetch(
            ghostUser.discord_user_id
          );
          try {
            await discordUser.roles.add(role);
            messages.push(
              `Role ${role.name} added to user ${discordUser.user.username}#${discordUser.user.tag}`
            );
            userCount++;
          } catch (e) {
            messages.push(
              `!!Warning!! Could not add role ${role.name} to user ${
                discordUser.user.username
              }#${discordUser.user.tag} : ${JSON.stringify(e)}`
            );
          }
        } catch (e) {
          messages.push(
            `!!Warning!! Could not add role ${role.name} to Ghost user ${
              ghostUser.email
            }: ${JSON.stringify(e)}`
          );
        }
      }
      messages.push(
        `Role ${role.name} handled successfully! ${userCount} users associated to the role`
      );
    }
    lastRefreshStatus = {
      result: "Success",
      messages,
    };
  } catch (error) {
    lastRefreshStatus = {
      result: "UnknownInternalError",
      error,
      messages: [
        "An unknown internal error happened during the refresh: " +
          JSON.stringify(error),
      ],
    };
    return;
  } finally {
    console.log("User list refresh complete!");
  }
}

/**
 * SERVER SETUP
 */

/** Whether to refresh the user list on next interval update */
let isRefreshScheduled = false;
function scheduleUserListRefresh() {
  isRefreshScheduled = true;
}

function checkIfRefreshIsNeeded() {
  if (isRefreshScheduled) {
    refreshMemberRolesOnDiscord().finally(() => {
      isRefreshScheduled = false;
      setTimeout(checkIfRefreshIsNeeded, 2000);
    });
  } else {
    setTimeout(checkIfRefreshIsNeeded, 2000);
  }
}

function getInternalWebhooksRoute() {
  const internalWebhooksRoute = express.Router();
  // This is the internal webhooks from Ghost
  // Notifies the bot when a member is added / removed / updated on the Ghost side of things
  // (currently exposed publicly, but later on will be able to update in other ways)
  internalWebhooksRoute.post("/added", (req, res) => {
    scheduleUserListRefresh();
    res.status(200).end();
  });
  internalWebhooksRoute.post("/updated", (req, res) => {
    scheduleUserListRefresh();
    res.status(200).end();
  });
  internalWebhooksRoute.post("/removed", (req, res) => {
    scheduleUserListRefresh();
    res.status(200).end();
  });
  return internalWebhooksRoute;
}

function getGhostUserRoute() {
  // This is the Discord integration flow.

  // Idea:
  // - A logged in user goes to /discord/connect
  // - We checked if they're logged in on Ghost's side
  // - They get redirected to the discord bot's connection on Discord's side
  // - Discord gives us a code on /discord/auth/callback
  // - We ask discord.com/api/users/@me for more information about the user (mainly, the user ID is interesting or us)
  // - We store the User email + the code + the information in the database

  const ghostUserRoute = express.Router();
  const discordAuth = new ClientOAuth2({
    clientId: config.discord.clientId,
    clientSecret: config.discord.clientSecret,
    accessTokenUri: "https://discord.com/api/oauth2/token",
    authorizationUri: "https://discord.com/oauth2/authorize",
    redirectUri: `${config.ghost.url}/discord/auth/callback`,
    scopes: ["identify"],
  });
  ghostUserRoute.get("/discord-integration-plugin.js", async (req, res) => {
    res.sendFile(path.join(__dirname, "./discord-integration-plugin.js"));
  });
  ghostUserRoute.get("/connect", (req, res) => {
    const username = req.cookies.get("ghost-members-ssr", { signed: true });
    if (!username) {
      res.status(401);
      res.send("Not logged in on Ghost");
      res.end();
      return;
    }
    const uri = discordAuth.code.getUri();
    res.redirect(uri);
  });
  ghostUserRoute.get("/auth/callback", async (req, res) => {
    const user = await discordAuth.code.getToken(req.originalUrl);
    const username = req.cookies.get("ghost-members-ssr", { signed: true });
    if (!username) {
      res.status(401);
      res.send("Not logged in on Ghost");
      res.end();
      return;
    }
    const response = await undici.request("https://discord.com/api/users/@me", {
      headers: {
        authorization: `${user.data.token_type} ${user.data.access_token}`,
      },
    });
    const body = await response.body.json();
    const existing = await knex(config.tables.users)
      .where("email", username)
      .first();
    if (existing) {
      await knex(config.tables.users)
        .where("email", username)
        .update("user_id", body.id)
        .update("token", JSON.stringify(user.data))
        .update("data", JSON.stringify(body));
    } else {
      await knex(config.tables.users).insert({
        email: username,
        user_id: body.id,
        token: JSON.stringify(user.data),
        data: JSON.stringify(body),
      });
    }
    scheduleUserListRefresh();
    res.redirect("/discord/loggedin");
    return;
  });
  ghostUserRoute.post("/disconnect", async (req, res) => {
    const username = req.cookies.get("ghost-members-ssr", { signed: true });
    if (!username) {
      res.status(401);
      res.send("Not logged in on Ghost");
      res.end();
      return;
    }
    const existing = await knex(config.tables.users)
      .where("email", username)
      .first();
    if (!existing) {
      res.status(404);
      res.json({
        result: "NoIntegration",
        message: "No existing integration to remove",
      });
      res.end();
      return;
    }
    await knex(config.tables.users).where("email", username).delete();
    res.status(200);
    res.json({
      result: "Removed",
      message: "Existing Discord integration was removed",
    });
    res.end();
    scheduleUserListRefresh();
    return;
  });
  ghostUserRoute.get("/loggedin", async (req, res) => {
    res.status(200);
    res.send(`<!DOCTYPE html><html><head><title>Log in success!</title></head><body style="margin: 0; background: #333; color: #FFF; display: flex; width: 100vw; height: 100vw; justify-content: center; align-items: center;"><h1>Log in successful!`);
    res.end();
  });
  ghostUserRoute.get("/status", async (req, res) => {
    const username = req.cookies.get("ghost-members-ssr", { signed: true });
    if (!username) {
      res.status(401);
      res.json({
        status: "NotLoggedIn",
        message: "Not logged in on Ghost",
      });
      res.end();
      return;
    }

    const user = await knex(config.tables.users)
      .where("email", username)
      .first();
    if (!user) {
      res.status(200);
      res.json({
        status: "NotIntegrated",
        message: "No Discord account associated with this ghost account",
      });
      res.end();
      return;
    }

    res.status(200);
    const data = JSON.parse(user.data);
    res.json({
      status: "Integrated",
      message: "Discord account associated with ghost account",
      data: data,
    });
    res.end();
    return;
  });
  return ghostUserRoute;
}

function getGhostAdminRoute() {
  const ghostAdminRoute = express.Router();
  ghostAdminRoute.use(async (req, res, next) => {
    const session = req.cookies.get("ghost-admin-api-session", {
      signed: false,
    });
    if (!session || !session.startsWith("s%3A")) {
      res.redirect("/ghost");
      return;
    }

    // This is a little bit shaky, as we're not checking whether the session token is signed,
    // but I'm not sure if we can get the signature key so... Not ideal.
    const content = session.substring("s%3A".length);
    const split = content.split(".");
    const sessionId = split[0];
    const association = await knex("sessions")
      .where("session_id", sessionId)
      .first();
    if (!association) {
      res.redirect("/ghost");
      return;
    }
    next();
    return;
  });
  ghostAdminRoute.get("/", (req, res) => {
    res.status(200);
    res.send(`<!DOCTYPE html>
  <html>
  <head>
    <title>Discord Config Temporary Page</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta charset="UTF-8">
  </head>
  <body>
    <h1>Discord Config Page</h1>
    <div>
    </div>
    <details id="bot-details">
      <summary id="bot-status">
        Bot Status: Unknown (click to update config)
      </summary>
      <div>
        <label>Token: <input id="discord-token"></label></br>
        <label>Client ID: <input id="discord-client-id"></label></br>
        <label>Client Secret: <input id="discord-client-secret"></label></br>
        <button onclick="sendNewDiscordSecrets()">Send new secrets and reload the bot</button>
      </div>
    </details>
    <div>
      <input id="guild-id">
      <button onclick="sendNewGuildId()">Update Guild ID</button>
    </div>
    <div>
      <h3>Manage Roles</h3>
      <button onclick="reloadRoles()">Re-request the list of roles from the Discord Guild</button>
      <div id="roles-list"></div>
    </div>
    <div>
      <h3>Roles Refresh</h3>
      <button onclick="reloadUsers()">Re-apply all roles to users</button>
      <button onclick="refreshStatus()">Refresh the logs of the last Discord bot run</button>
      <div id="bot-refresh-status"></div>
      <div id="bot-refresh-log"></div>
    </div>
    <script type="application/javascript">
      async function refreshStatus() {
        const request = await fetch("/ghost/discord/status");
        const data = await request.json();
        const botStatusElement = document.getElementById("bot-status");
        if (data.botStatus) {
          botStatusElement.innerHTML = "Bot Status: <span style=\\"color: green;\\">Online</span> (click to reconfigure)";
        } else if (data.botConfig) {
          botStatusElement.innerHTML = "Bot Status: <span style=\\"color: red;\\">Offline</span> (incorrect config resulting in connection issue - click to reconfigure)";
        } else {
          botStatusElement.innerHTML = "Bot Status: <span style=\\"color: red;\\">Offline</span> (no config - click to reconfigure)";
        }
        document.getElementById("guild-id").value = data.guildId;
        if (data.pendingRefresh) {
          document.getElementById("bot-refresh-status").innerText = "Refresh is pending";
        } else if (data.lastRefresh) {
          document.getElementById("bot-refresh-status").innerText = "Last refresh results: " + data.lastRefresh.result;
        } else {
          document.getElementById("bot-refresh-status").innerText = "No refreshes have been done yet";
        }
        let lastRefreshLogs = "";
        if (data.lastRefresh) {
          for (const message of data.lastRefresh.messages) {
            lastRefreshLogs += "<div>";
            lastRefreshLogs += message;
            lastRefreshLogs += "</div>";
          }
        }
        document.getElementById("bot-refresh-log").innerHTML = lastRefreshLogs;
      }
      async function sendNewDiscordSecrets() {
        const token = document.getElementById("discord-token").value;
        const clientId = document.getElementById("discord-client-id").value;
        const clientSecret = document.getElementById("discord-client-secret").value;
        const response = await fetch("/ghost/discord/config/update/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({  
            token: token,
            clientId: clientId,
            clientSecret: clientSecret,
          }),
        });
        const data = await response.json();
        if (data.status === "ReloadedBot") {
          document.getElementById("bot-details").open = false;
          refreshStatus();
        }
      }
      async function sendNewGuildId() {
        const response = await fetch("/ghost/discord/config/update/guild", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({  
            guildId: guildId,
          }),
        });
        const data = await response.json();
      }
      async function refreshRolesDisplay() {
        const request = await fetch("/ghost/discord/roles/list");
        const data = await request.json();
        console.log(data);
        const rolesElement = document.getElementById("roles-list");
        let result = "<ul>";
        for (const role of data.roles) {
          const roleData = JSON.parse(role.data);
          result += "<li>";
          result += roleData.name;
          result += " - ";
          if (role.is_handled_by_bot) {
            result += "Handled by bot";
            result += \`<button onclick="removeRoleHandling('\${role.id}')">Stop handling role</button>\`;
            result += "Associated Ghost tier(s):";
            let hasAssociation = false;
            for (const association of data.associations) {
              if (association.discord_role_id !== role.id) continue;
              const tier = data.tiers.find(t => t.slug === association.slug);
              if (!tier) continue;
              hasAssociation = true;
              result += " <span class=\\"associated-tier\\">";
              result += tier.name;
              result += \`<button onclick="removeTierToRoleAssociation('\${role.id}', '\${tier.slug}')">Remove</button>\`;
              result += "</span>";
            }
            if (!hasAssociation) {
              result += " None";
            }
            result += "<details>";
            result += "<summary>Associate more tiers:</summary>";
            result += "<ul>";
            for (const tier of data.tiers) {
              result += "<li><label>";
              result += tier.name;
              result += \`<button onclick="associateTierWithRole('\${role.id}', '\${tier.slug}')">Associate</button>\`;
              result += "</label></li>";
            }
            result += "</ul>";
            result += "</details>";
          } else {
            result += "Not handled by bot";
            result += \`<button onclick="addRoleHandling('\${role.id}')">Handle role</button>\`;
          }
          result += "</li>";
        }
        result += "</ul>";
        rolesElement.innerHTML = result;
      }
      async function reloadRoles() {
        const result = await fetch("/ghost/discord/refresh/roles", { method: "POST" });
        const data = await result.json();
        refreshRolesDisplay();
      }
      async function reloadUsers() {
        const result = await fetch("/ghost/discord/refresh/users", { method: "POST" });
        const data = await result.json();
      }
      async function addRoleHandling(roleId) {
        const response = await fetch("/ghost/discord/roles/set-bot-handling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({  
            isHandledByBot: true,
            discordRoleId: roleId,
          }),
        });
        const data = await response.json();
        refreshRolesDisplay();
      }
      async function removeRoleHandling(roleId) {
        const response = await fetch("/ghost/discord/roles/set-bot-handling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({  
            isHandledByBot: false,
            discordRoleId: roleId,
          }),
        });
        const data = await response.json();
        refreshRolesDisplay();
      }
      async function associateTierWithRole(roleId, slug) {
        const response = await fetch("/ghost/discord/roles/add-association", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({  
            slug: slug,
            discordRoleId: roleId,
          }),
        });
        const data = await response.json();
        refreshRolesDisplay();
      }
      async function removeTierToRoleAssociation(roleId, slug) {
        const response = await fetch("/ghost/discord/roles/remove-association", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({  
            slug: slug,
            discordRoleId: roleId,
          }),
        });
        const data = await response.json();
        refreshRolesDisplay();
      }
      refreshStatus();
      refreshRolesDisplay();
    </script>
  </body>
  </html>`);
    res.end();
  });
  ghostAdminRoute.get("/status", async (req, res) => {
    res.status(200);
    res.json({
      status: "LoggedIn",
      message: "Detected as logged in for the ghost Discord integration",
      botStatus: !!botClient,
      botConfig: !!(
        config.discord.token &&
        config.discord.clientId &&
        config.discord.clientSecret
      ),
      guildId: config.discord.guildId,
      pendingRefresh: isRefreshScheduled,
      lastRefresh: lastRefreshStatus,
    });
    res.end();
  });
  ghostAdminRoute.get("/roles/list", async (req, res) => {
    const roles = await knex(config.tables.roles).select({
      id: "discord_role_id",
      is_handled_by_bot: "is_handled_by_bot",
      data: "data",
    });
    const associations = await knex(config.tables.role_associations).select({
      slug: "slug",
      discord_role_id: "discord_role_id",
    });
    const fetchedTiers = await undici.request(
      `${config.ghost.url}/ghost/api/content/tiers/?key=${config.ghost.contentToken}`,
      {
        headers: {
          "Accept-Version": "v5.0",
        },
      }
    );
    const tiers = await fetchedTiers.body.json();
    res.status(200);
    res.json({
      roles: roles,
      associations: associations,
      tiers: tiers.tiers,
    });
    res.end();
  });
  ghostAdminRoute.post("/roles/set-bot-handling", async (req, res) => {
    if (!req.body) {
      res.status(400);
      res.json({
        status: "NoProvidedBody",
        message:
          "Provided body should look like { isHandledByBot: '', discordRoleId: '' }",
      });
      res.end();
      return;
    }
    const isHandledByBot = req.body.isHandledByBot;
    const discordRoleId = req.body.discordRoleId;
    if (!isHandledByBot || !discordRoleId) {
      res.status(400);
      res.json({
        status: "InvalidBody",
        message:
          "Provided body should look like { isHandledByBot: '', discordRoleId: '' }",
      });
      res.end();
      return;
    }
    await knex(config.tables.roles)
      .where("discord_role_id", discordRoleId)
      .update({
        is_handled_by_bot: !!isHandledByBot,
      });
    res.status(200);
    res.json({
      status: "BotHandlingUpdated",
      message: "Bot handling updated successfully",
    });
    res.end();
  });
  ghostAdminRoute.post("/roles/add-association", async (req, res) => {
    if (!req.body) {
      res.status(400);
      res.json({
        status: "NoProvidedBody",
        message:
          "Provided body should look like { slug: '', discordRoleId: '' }",
      });
      res.end();
      return;
    }
    const slug = req.body.slug;
    const discordRoleId = req.body.discordRoleId;
    if (!slug || !discordRoleId) {
      res.status(400);
      res.json({
        status: "InvalidBody",
        message:
          "Provided body should look like { slug: '', discordRoleId: '' }",
      });
      res.end();
      return;
    }
    await knex(config.tables.role_associations).insert({
      slug,
      discord_role_id: discordRoleId,
    });
    res.status(200);
    res.json({
      status: "AssociationAdded",
      message: "Association added successfully",
    });
    res.end();
  });
  ghostAdminRoute.post("/roles/remove-association", async (req, res) => {
    if (!req.body) {
      res.status(400);
      res.json({
        status: "NoProvidedBody",
        message:
          "Provided body should look like { slug: '', discordRoleId: '' }",
      });
      res.end();
      return;
    }
    const slug = req.body.slug;
    const discordRoleId = req.body.discordRoleId;
    if (!slug || !discordRoleId) {
      res.status(400);
      res.json({
        status: "InvalidBody",
        message:
          "Provided body should look like { slug: '', discordRoleId: '' }",
      });
      res.end();
      return;
    }
    await knex(config.tables.role_associations)
      .where("slug", slug)
      .where("discord_role_id", discordRoleId)
      .delete();
    res.status(200);
    res.json({
      status: "AssociationRemoved",
      message: "Association removed successfully",
    });
    res.end();
  });
  ghostAdminRoute.post("/refresh/roles", async (req, res) => {
    await refreshRolesFromDiscord();
    res.status(200);
    res.json({
      status: "RefreshEnded",
      message: "Refreshed the list of roles from the Discord server",
    });
    res.end();
  });
  ghostAdminRoute.post("/refresh/users", async (req, res) => {
    scheduleUserListRefresh();
    res.status(200);
    res.json({
      status: "RefreshScheduled",
      message: "List of user refresh has been scheduled",
    });
    res.end();
  });
  ghostAdminRoute.post("/config/update/tokens", async (req, res) => {
    if (!req.body) {
      res.status(400);
      res.json({
        status: "NoProvidedBody",
        message:
          "Provided body should look like { token: '', clientId: '', clientSecret: '' }",
      });
      res.end();
      return;
    }
    const token = req.body.token;
    const clientId = req.body.clientId;
    const clientSecret = req.body.clientSecret;
    if (!token || !clientId || !clientSecret) {
      res.status(400);
      res.json({
        status: "InvalidBody",
        message:
          "Provided body should look like { token: '', clientId: '', clientSecret: '' }",
      });
      res.end();
      return;
    }

    // Load Discord-specific information
    await updateSetting("discord_integration", "token", token);
    await updateSetting("discord_integration", "client_id", clientId);
    await updateSetting("discord_integration", "client_secret", clientSecret);
    await reloadConfigFromDatabase();
    await reloadBotClient();
    res.status(200);
    res.json({
      status: "ReloadedBot",
      message: "Configs have been updated and bot reloaded",
    });
    res.end();
  });
  ghostAdminRoute.post("/config/update/guild", async (req, res) => {
    if (!req.body) {
      res.status(400);
      res.json({
        status: "NoProvidedBody",
        message: "Provided body should look like { guildId: '' }",
      });
      res.end();
      return;
    }
    const guildId = req.body.guildId;
    if (!guildId) {
      res.status(400);
      res.json({
        status: "InvalidBody",
        message: "Provided body should look like { guildId: '' }",
      });
      res.end();
      return;
    }

    // Load Discord-specific information
    await updateSetting("discord_integration", "guild_id", guildId);
    await reloadConfigFromDatabase();
    res.status(200);
    res.json({
      status: "ReloadedBot",
      message: "Configs have been updated",
    });
    res.end();
  });
  return ghostAdminRoute;
}

async function initExpressServer() {
  // Below this is the server stuff
  const app = express();
  app.use(bodyParser.json());

  // This is the cookie validation thing, used when checking whether an user is logged in on Ghost's side
  const cookieSignatureData = await knex("settings")
    .select("value")
    .where("group", "core")
    .where("key", "theme_session_secret")
    .first();
  const cookieSignature = cookieSignatureData.value;
  app.use(Cookies.express([cookieSignature]));

  app.use("/members", getInternalWebhooksRoute());
  app.use("/discord", getGhostUserRoute());
  app.use("/ghost/discord", getGhostAdminRoute());

  app.listen(config.server.port, "localhost", () => {
    console.log(`Server started on port ${config.server.port}`);
  });
}

(async () => {
  console.log("Loading config from the database...");
  await reloadConfigFromDatabase();
  console.log("Initializing new databases if needed...");
  await initializeDatabasesIfNeeded();
  reloadBotClient();
  checkIfRefreshIsNeeded();
  console.log("Initializing server...");
  await initExpressServer();
  console.log("Ready!");
})();
