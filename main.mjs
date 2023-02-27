import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { generateBlahajData } from "./generate.mjs";
import { CronJob } from "cron";
import process from "process";
import webpush from "web-push";
import crypto from "crypto"

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "public");
const blahajDataPath = path.resolve(publicDir, "blahaj.json");

const app = express();

const subsPath = "./subs.json";

async function loadSubs() {
	const subs = await fs.readFile(subsPath).then(e => JSON.parse(e)).catch(e => console.error(e));
	return subs ?? {};
}

async function saveSubs(subs) {
	await fs.writeFile(subsPath, JSON.stringify(subs, null, 2));
}

async function runNotifications(oldData, newData) {
	const restocked = {};

	// check for restocks
	for(const [product, stores] of Object.entries(newData.data)) {
		restocked[product] = {};
		for(const newStore of stores) {
			const oldStore = oldData.data[product].find(e => e.name == newStore.name);
			if(!oldStore) continue;
			if(oldStore.quantity < newStore.quantity) {
				restocked[product][newStore.name] = {product, newStore, oldStore};
			}
		}
	}

	const subs = await loadSubs();
	for(const sub of Object.values(subs)) {
		for(const notify of sub.notify) {
			const restock = restocked[notify.product];
			if(!restock) continue;
			const storeRestock = restock[notify.store];
			if(!storeRestock) continue;

			const res = await webpush.sendNotification(sub.push, JSON.stringify({
				event: "restock",
				data: storeRestock,
			}), {
				vapidDetails: {
					subject: `mailto:test@yuv.pink`,
					publicKey: vapidKeys.publicKey,
					privateKey: vapidKeys.privateKey,
				}
			}).catch(err => console.error(err));
			console.log(res);
		}
	}
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
	return [...new Uint8Array(buffer)]
		.map(x => x.toString(16).padStart(2, '0'))
		.join('');
  }

async function subid(endpoint) {
	return buf2hex(await crypto.subtle.digest("SHA-256", endpoint));	
}

async function saveSubscriptionToDatabase(sub) {
	const subs = await loadSubs();
	if(!sub.notify) {
		sub.notify = []
	}
	const sub_id = await subid(sub.push.endpoint).catch(e => console.error(e));
	console.log("saving", sub_id, sub);
	if(!sub_id) return false;
	subs[sub_id] = sub;
	await saveSubs(subs);
	return true;
}

async function isValidSaveRequest(sub) {
	if(sub.push == null) return false;
	if(typeof sub.push.endpoint !== "string") return false;
	if(sub.push.keys == null) return false;
	if(typeof sub.push.keys.p256dh !== "string") return false;
	if(typeof sub.push.keys.auth !== "string") return false;
}

async function updateBlahajData() {
	const oldData = await fs.readFile(blahajDataPath).then(e => JSON.parse(e)).catch(e => console.error);
	const currentData = await generateBlahajData();
	await runNotifications(oldData, currentData);
	await fs.writeFile(blahajDataPath, JSON.stringify(currentData));
}

app.use(express.static(publicDir));
app.use(express.json());

const port = process.env.PORT || 8060;


// VAPID keys should be generated only once.
const vapidPath = "./vapid.json";
/** @type {webpush.VapidKeys} */
let vapidKeys;

app.get("/vapidPublic", (_, res) => {
	res.status(200).send(vapidKeys.publicKey);
});

app.post("/api/sub-get-notify", async function (req, res) {
	const subs = await loadSubs();
	const sub_id = await subid(req.body.endpoint).catch(e => console.error(e));
	const sub = subs[sub_id];
	if(!sub) {
		console.log("get-notify", sub_id, "not found")
		res.status(404);
		res.send();
		return;
	}
	res.status(200);
	res.json(sub.notify);
	return;
})

app.post("/api/sub-set-notify", async function (req, res) {
	const subs = await loadSubs();
	const sub_id = await subid(req.body.endpoint);
	const sub = subs[sub_id];
	if(!sub) {
		console.log("set-notify", sub_id, "not found")
		res.status(404);
		res.send();
		return;
	}
	sub.notify = req.body.notify;
	subs[sub_id] = sub;
	await saveSubs(subs);

	res.status(200);
	res.json(sub.notify);
	return;
})

app.post('/api/save-subscription/', async function (req, res) {
	if (!isValidSaveRequest(req.body)) {
		res.status(500);
		res.send();
		return;
	}

	const resp = await webpush.sendNotification(req.body.push, JSON.stringify({
		event: "test",
		data: "Test Event",
	}), {
		vapidDetails: {
			subject: `mailto:test@yuv.pink`,
			publicKey: vapidKeys.publicKey,
			privateKey: vapidKeys.privateKey,
		}
	}).catch(err => {
		console.error(err);
		res.status(500);
		res.setHeader('Content-Type', 'application/json');
		res.send(
		  JSON.stringify({
			error: {
			  id: 'unable-to-save-subscription',
			  message:
				'The subscription was received but we were unable to save it to our database.',
			},
		  }),
		);
	});
	if(!resp) return;
	console.log(resp);
  
	const save = await saveSubscriptionToDatabase(req.body).catch(function (err) {
		console.error(err);
		res.status(500);
		res.setHeader('Content-Type', 'application/json');
		res.send(
		  JSON.stringify({
			error: {
			  id: 'unable-to-save-subscription',
			  message:
				'The subscription was received but we were unable to save it to our database.',
			},
		  }),
		);
	  });

	let success = true;
	if(!save) {
		success = false;
	}

	res.setHeader('Content-Type', 'application/json');
	res.send(JSON.stringify({data: {success: success}}));
  });


(async () => {
	if(await fs.pathExists(vapidPath)) {
		vapidKeys = JSON.parse(await fs.readFile(vapidPath));
	} else {
		console.log("generating push keys");
		vapidKeys = webpush.generateVAPIDKeys();
		await fs.writeFile(vapidPath, JSON.stringify(vapidKeys));
	}

	fs.pathExists(blahajDataPath).then(exists => {
		if (!exists) updateBlahajData();
	});

	new CronJob("0 * * * *", updateBlahajData, null, true);
	updateBlahajData();

	app.listen(port, () => {
		console.log(`Server listening on http://127.0.0.1:${port}`);
	});
})();
