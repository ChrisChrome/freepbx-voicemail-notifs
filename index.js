const config = require("./config.json");
const fs = require("fs");

// Setup GQL Client
const {
	FreepbxGqlClient,
	gql
} = require("freepbx-graphql-client");
const pbxClient = new FreepbxGqlClient(config.freepbx.url, {
	client: {
		id: config.freepbx.clientid,
		secret: config.freepbx.secret,
	}
});

// Setup Discord client
const Discord = require("discord.js");
const client = new Discord.Client({intents: ["Guilds", "GuildMembers"]});

// Setup filesystem monitoring (for new voicemail)
const chokidar = require("chokidar");
const watcher = chokidar.watch(config.freepbx.voicemaildir, {
	ignored: /(^|[\/\\])\../,
	persistent: true
});

watcher.on("all", (event, path) => {
	console.log(event, path);
});