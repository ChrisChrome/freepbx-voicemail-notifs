const config = require("./config.json");
const fs = require("fs");
const fpbxFuncs = require("./fpbxFuncs.js");
const path = require("path");
function pathSplit(p) {
	return p.split("/");
}
var startup = true;

const lookupExtension = (ident, type) => { // type is either "ext" or "uid"
	return new Promise((resolve, reject) => {
		switch (type) {
			case "ext":
				pbxClient.request(fpbxFuncs.generateQuery('lookup', {
					ext: ident
				})).then((result) => {
					res = {
						"status": "exists",
						"result": result
					}
					resolve(res);
				}).catch((error) => {
					res = {
						"status": "notfound",
						"result": error
					}
					reject(res);
				});
				break;
			case "uid":
				// Find the extension based on Discord ID in the voicemail email field
				pbxClient.request(fpbxFuncs.generateQuery('list', {})).then(async (result) => {
					// loop through all extensions, run a lookup on each one, and return the first one that matches
					var found = false;
					var ext = "";
					var count = 0;
					result.fetchAllExtensions.extension.forEach(async (ext) => {
						pbxClient.request(fpbxFuncs.generateQuery('lookup', {
							ext: ext.user.extension
						})).then((result) => {
							if (result.fetchVoiceMail.email == ident && !found) {
								found = true;
								ext = result;
								clearInterval(x);
								resolve({
									"status": "exists",
									"result": ext
								})
							}
							count++;
						}).catch((error) => {
							reject(error);
						});
					});
					x = setInterval(() => {
						if (count == result.fetchAllExtensions.extension.length) {
							clearInterval(x);
							if (!found) {
								reject("Not found");
							}
						}
					}, 100);

				}).catch((error) => {
					reject(error);
				});
				break;
			default:
				reject("Invalid type");
		}
	});
}

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
const client = new Discord.Client({ intents: ["Guilds", "GuildMembers"] });

// Setup filesystem monitoring (for new voicemail)
const chokidar = require("chokidar");
const watcher = chokidar.watch(config.freepbx.voicemaildir, {
	ignored: /(^|[\/\\])\../,
	persistent: true
});
watched = [];
watcher.on("add", async (filePath, stats) => {
	if (startup) return;
	// if the file is already being watched, ignore it, this stops spam from the watcher at startup
	if (watched.includes(filePath)) return;
	watched.push(filePath);
	// extract file name from path
	let filename = pathSplit(filePath)[pathSplit(filePath).length - 1];
	if (!filename.endsWith("txt")) return; // ignore anything that isn't a txt file (voicemail info file), we can get other file names based on the name without the extension
	let mailbox = pathSplit(filePath)[pathSplit(filePath).length - 2];
	if (mailbox !== "INBOX") return; // ignore anything that isn't in the inbox
	vmData = fpbxFuncs.parseVoicemailInfo(fs.readFileSync(filePath, "utf8"))
	// get the extension info from the origmailbox
	let extData = await lookupExtension(vmData.origmailbox, "ext").catch((error) => {
		console.log(error);
	});
	let discordId = extData.result.fetchVoiceMail.email;
	let discordUser = await client.users.fetch(discordId).catch((error) => {
		console.log(error);
	});
	// get the voicemail file (.wav)
	let vmFile = filePath.replace(".txt", ".wav");
	// get buffer from voicemail wav
	let vmBuffer = fs.readFileSync(vmFile);
	await discordUser.send(`:mailbox_with_mail: New voicemail from ${vmData.callerid}!`, {
		files: [{
			attachment: vmBuffer,
			name: `${vmData.callerid}.wav`
		}]
	}).catch((error) => {
		console.log(`Could not send voicemail to ${discordUser.tag}, probably because they have DMs disabled`);
	})
});

// Setup Discord bot
client.on("ready", () => {
	console.log(`Logged in as ${client.user.tag}!`);
	startup = false;
});


client.login(config.discord.token).catch((error) => {
	console.log(error);
});