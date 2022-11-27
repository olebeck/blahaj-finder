import axios from "axios";
import { blahajDb } from "./blahaj-db.mjs";
import pLimit from "p-limit";

async function getStock(countryCode, languageCode, itemCode) {
	try {
		const stores = await axios({
			url: `https://www.ikea.com/${countryCode}/${languageCode}/meta-data/navigation/stores-detailed.json`,
		});

		const stock = await axios({
			url: `https://api.ingka.ikea.com/cia/availabilities/ru/${countryCode}`,
			headers: {
				Accept: "application/json;version=2",
				Referer: "https://www.ikea.com/",
				"X-Client-Id": "b6c117e5-ae61-4ef5-b4cc-e0b1e37f0631",
			},
			params: {
				itemNos: itemCode,
				// expand: "StoresList,Restocks,SalesLocations",
				expand: "StoresList",
			},
		});

		if(stock.data.errors?.length > 0) {
			throw stock.data.errors[0];
		}

		return stock.data.availabilities
			.map(storeAvail => {
				const carryQuantity = storeAvail?.buyingOption?.cashCarry?.availability?.quantity;
				const deliveryQuantity = storeAvail?.buyingOption?.homeDelivery?.availability?.quantity;
				if (carryQuantity == null && deliveryQuantity == null) return null;
				const quantity = carryQuantity ?? 0 + deliveryQuantity ?? 0;

				const storeId = storeAvail?.classUnitKey?.classUnitCode;
				const store = stores.data.find(store => store.id == storeId);
				if (store == null) return null;

				return {
					quantity,
					name: store.name,
					lat: store.lat,
					lng: store.lng,
				};
			}).filter(store => store != null);
	} catch (error) {
		console.error(countryCode + "-" + languageCode + " failed", error);
		return [];
	}
}

export async function generateBlahajData() {
	const product_names = Object.keys(blahajDb);

	const blahajData = {};
	
	for(const product_name of product_names) {
		const regions = blahajDb[product_name];

		const blahajRequestInfo = Object.values(regions).flat();

		const limit = pLimit(10); // requests at a time
		const blahajStockResponse = await Promise.all(
			blahajRequestInfo.map(info =>
				limit(() => getStock(info[0], info[1], info[2])),
			),
		);

		// flattens [[],[],[]] to a single array
		blahajData[product_name] = blahajStockResponse.flat();
		console.log(`Fetched ${product_name} data from ${blahajData[product_name] .length} stores`);

		const total = blahajData[product_name].reduce((a,b) => a + b.quantity, 0);
		console.log(`Total ${product_name}: ${total}`);
	}

	return {
		updated: new Date().toISOString(),
		data: blahajData,
	};
}
