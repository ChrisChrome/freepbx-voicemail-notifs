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
const client = new Discord.Client({ intents: ["Guilds", "GuildMembers", "DirectMessages"] });

// Setup filesystem monitoring (for new voicemail)
const chokidar = require("chokidar");
const watcher = chokidar.watch(config.freepbx.voicemaildir, {
	ignored: /(^|[\/\\])\../,
	persistent: true
});

watched = [];
watcher.on("add", async (filePath, stats) => {
    if (startup) return;
    if (watched.includes(filePath)) return; 
    watched.push(filePath);
    let filename = pathSplit(filePath)[pathSplit(filePath).length - 1];
    if (!filename.endsWith("wav")) return; 
    
    let mailbox = pathSplit(filePath)[pathSplit(filePath).length - 2];
    if (mailbox !== "INBOX") return;  

    let txtFile = filePath.replace(".wav", ".txt");
    if (!fs.existsSync(txtFile)) return;
    vmData = fpbxFuncs.parseVoicemailInfo(fs.readFileSync(txtFile, "utf8"));
    
    let extData = await lookupExtension(vmData.origmailbox, "ext").catch((error) => {
        console.log(error);
    });
    if (!extData) return; 

    let discordId = extData.result.fetchVoiceMail.email;
    let discordUser = await client.users.fetch(discordId).catch((error) => {
        console.log(error);
    });

    let callerid = vmData.callerid;
    let calleridName = callerid.split(" <")[0].replaceAll("\"", "");
    let calleridNumber = callerid.split(" <")[1].replace(">", "");
    vmData.callerid = `${calleridName} (${calleridNumber})`;

    await discordUser.send({
        content: `:mailbox_with_mail: New voicemail from ${vmData.callerid}!`,
        files: [{
            attachment: filePath,
            name: `voicemail.wav`
        }]
    }).catch((error) => {
        console.log(`Could not send voicemail to ${discordUser.tag}, probably because they have DMs disabled\n${error}`);
    }) 
});

watcher.on('unlink', (filePath) => {
	watched.splice(watched.indexOf(filePath), 1);
});

// Setup Discord bot
client.on("ready", async () => {
	console.log(`Logged in as ${client.user.tag}!`);
	startup = false;
});


client.login(config.discord.token).catch((error) => {
	console.log(error);
});