const config = require("./config.json");
const fs = require("fs");
const fpbxFuncs = require("./fpbxFuncs.js");

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
watcher.on("add", async (event, path) => {
	// if the file is already being watched, ignore it, this stops spam from the watcher at startup
	if (watched.includes(path)) return;
	watched.push(path);

	// extract file name from path
	let filename = path.split("/").pop();
	// extract mailbox from path (path looks like /var/spool/asterisk/voicemail/default/1000/INBOX/file.wav)
	let mailbox = path.split("/")[6];
	if(mailbox !== "INBOX") return; // ignore anything that isn't in the inbox
	// if its a txt file (voicemail info), open it and get relavent info
	// make a json object with the callerid, duration, origdate, and origmailbox from the txt file
	if (filename.endsWith(".txt")) {
		let file = fs.readFileSync(path, "utf8");
		let lines = file.split("\n");
		let callerid = lines[9].split("=")[1].replace(/"/g, "");
		let duration = lines[17].split("=")[1];
		let origdate = lines[11].split("=")[1];
		let origmailbox = lines[2].split("=")[1];
		let message = {
			"callerid": callerid,
			"duration": duration,
			"origdate": origdate,
			"origmailbox": origmailbox
		}
		// get the extension info from the callerid
		let ext = await lookupExtension(callerid, "uid");
		console.log(`New voicemail from ${message.callerid} (${message.duration}s)`);
	}
});