let my_notify = [];

function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);

    for (var i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function registerServiceWorker() {
    const registration = await navigator.serviceWorker.register('./service-worker.js', {
        scope: `${location.protocol}//${location.hostname}${location.pathname}`
        }).catch(function (err) {
        console.error('Unable to register service worker.', err);
        });
    console.log('Service worker successfully registered.');
    return registration;
}

async function askPushPermission() {
    const permissionResult = await Notification.requestPermission();
    if (permissionResult !== 'granted') {
        throw new Error("We weren't granted permission.");
    }
}

async function subscribeUserToPush() {
    const serverKey = await (await fetch("./vapidPublic")).text();
    const registration = await registerServiceWorker();
    const subscribeOptions = {
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(serverKey),
    };

    const pushSubscription = await registration.pushManager.subscribe(subscribeOptions);
    console.log(
        'Received PushSubscription: ',
        JSON.stringify(pushSubscription),
    );
    return pushSubscription;
}

async function sendSubscriptionToBackEnd(subscription) {
    const response = await fetch('./api/save-subscription/', {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        },
        body: JSON.stringify({
        push: subscription,
        })
    });
    if (!response.ok) {
        throw new Error('Bad status code from server.');
    }
    const responseData = await response.json();

    if (!(responseData.data && responseData.data.success)) {
        throw new Error('Bad response from server.');
    }
}

async function getSubscription() {
    await askPushPermission();
    const reg = await registerServiceWorker();
    const sub = await reg.pushManager.getSubscription();
    return sub;
}

async function api_get_notify(push, retry = false) {
    const resp = await fetch("./api/sub-get-notify", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            endpoint: push.endpoint
        })
    });

    if(resp.status == 404 && !retry) {
        await sendSubscriptionToBackEnd(push);
        return await api_get_notify(push, true)
    }

    const body = await resp.json();
    return body;
}

async function api_set_notify(push, notify, retry = false) {
    const resp = await fetch("./api/sub-set-notify", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            endpoint: push.endpoint,
            notify: notify,
        }),
    });

    if(resp.status == 404 && !retry) {
        await sendSubscriptionToBackEnd(push, true);
    }

    const body = await resp.json();
    return body;
}

async function subscribeStore(product, store) {
    let push = await getSubscription();
    if(!push) {
        console.log("registering new subscription")
        push = await subscribeUserToPush();
        await sendSubscriptionToBackEnd(push);
    }

    my_notify = await api_get_notify(push);
    if(!my_notify) {
        await sendSubscriptionToBackEnd(push);
        my_notify = await api_get_notify(push);
    }
    my_notify.push({
        product: product,
        store: store,
    });
    await api_set_notify(push, my_notify);
}

async function unsubscribeStore(product, store) {
    await askPushPermission();
    const push = await getSubscription();
    if(push) {
        my_notify = await api_get_notify(push);
        my_notify = my_notify.filter(e => !(e.store == store && e.product == product));
        await api_set_notify(push, my_notify);
    }
}

(async () => {
    const push = await getSubscription();
    if(push) {
        console.log("getting notifications");
        my_notify = await api_get_notify(push);
    } else {
        console.log("not subscribed");
    }
})();

const mapLoadImage = url =>
    new Promise((resolve, reject) => {
        map.loadImage(url, function (error, image) {
            if (error) return reject(error);
            return resolve(image);
        });
    });

const maptilerKey = "";

const styles = [
    //[
    //	"Self-hosted",
    //	"https://tileserver.cutelab.space/styles/streets/style.json",
    //],
    ["OpenStreetMap", "styles/osm-mapnik.json"],
    // [
    // 	"MapTiler (might not work)",
    // 	"https://api.maptiler.com/maps/streets/style.json?key=" +
    // 		maptilerKey,
    // ],
    ["Stamen Watercolor", "styles/stamen-watercolor.json"],
];

const stylePicker = document.getElementById("style-picker");
styles
    .map(([name, url], i) => {
        const input = document.createElement("input");
        input.type = "radio";
        input.id = "style-" + name;
        input.name = "style";
        input.autocomplete = "off";
        if (i == 0) input.setAttribute("checked", "");

        input.addEventListener("click", () => {
            map.setStyle(url);
        });

        const label = document.createElement("label");
        label.setAttribute("for", "style-" + name);
        label.textContent = name;

        const div = document.createElement("div");
        div.appendChild(input);
        div.appendChild(label);

        return div;
    })
    .forEach((el, i) => {
        if (i != 0) {
            const span = document.createElement("span");
            span.className = "spacer";
            stylePicker.appendChild(span);
        }

        stylePicker.appendChild(el);
    });

const toggleableLayers = ["markers", "heatmap"];
const layerVisibility = { markers: true, heatmap: true };

const map = new maplibregl.Map({
    container: "map",
    style: styles[0][1],
    center: [15, 20],
    zoom: 1.8,
});

map.addControl(new maplibregl.NavigationControl());

map.dragRotate.disable();
map.touchZoomRotate.disableRotation();


const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

function formatNum(d) {
    if(d[0] == "0") d = d.slice(1);
    let end = ["st","nd","rd","th"][Math.min(Math.max(d-1, 0), 3)];
    return d+end;
}

function formatDate(d) {
    const s = d.split("-");
    const month = monthNames[Number(s[1])];
    const day = formatNum(s[2]);
    return `${month} ${day}`;
}

const blahaj_json_resp = fetch("blahaj.json?" + Date.now());

map.on("style.load", async () => {
    const blahajData = await (await blahaj_json_resp).json();
    const product_names = Object.keys(blahajData.data);
    
    const updated = new Date(blahajData.updated);
    document.getElementById("updated").textContent =
        updated.toLocaleString();

    const markerIconsSize = 2;
    const markerIcons = {
        opaque: ["marker1", "marker2"],
        faded: ["marker1-faded", "marker2-faded"],
    };

    for (const name of [...markerIcons.opaque, ...markerIcons.faded]) {
        map.addImage(
            name,
            await mapLoadImage(
                "img/marker-icons/48/" + name + ".png",
            ),
        );
    }

    function marker_click(e) {
        const f = e.features[0];
        const p = f.properties;
        const coordinates = f.geometry.coordinates.slice();
        const div = document.createElement("div");
        div.style.display = "flex";
        div.style.flexDirection = "column";
        div.style.alignItems = "center";

        const description = document.createElement("span");
        description.innerText = `${p.store} has ${p.quantity} ${p.product}`;
        div.appendChild(description);

        if(p.restocks?.length > 0) {
            const restock_text = document.createElement("span");
            restock_text.style.overflowWrap = "nowrap";
            JSON.parse(p.restocks).map(restock => {
                const restockType = {
                    "DELIVERY": "delivery"
                }[restock.type] ?? restock.type;
                const earliestDate = formatDate(restock.earliestDate);
                const latestDate = formatDate(restock.latestDate);
                restock_text.innerText += `${restockType} of ${restock.quantity} between ${earliestDate} and ${latestDate}\n`
            });
            div.appendChild(restock_text);
        }

        const subscribe = document.createElement("button");
        if(my_notify.find(e => e.product == p.product && e.store == p.store)) {
            subscribe.onclick = () => {
                unsubscribeStore(p.product, p.store);
            }
            subscribe.innerText = "remove subscription";
        } else {
            subscribe.onclick = () => {
                subscribeStore(p.product, p.store);
            }
            subscribe.innerText = "subscribe for restocks";
        }
        div.appendChild(subscribe);

        new maplibregl.Popup()
            .setLngLat(coordinates)
            .setDOMContent(div)
            .addTo(map);
    }

    function add_product(name) {
        map.addSource(name, {
            type: "geojson",
            data: {
                type: "FeatureCollection",
                features: blahajData.data[name].map(store => ({
                    type: "Feature",
                    properties: {
                        icon: (store.quantity == 0 ? markerIcons.faded : markerIcons.opaque)[Math.floor(Math.random() * markerIconsSize)],
                        weight: store.quantity / 32,
                        store: store.name,
                        product: name,
                        quantity: store.quantity,
                        restocks: store.restocks,
                    },
                    geometry: {
                        type: "Point",
                        coordinates: [store.lng, store.lat],
                    },
                })),
            },
        });

        map.addLayer({
            id: name+"_heatmap",
            source: name,
            type: "heatmap",
            paint: {
                "heatmap-weight": {
                    property: "weight",
                    type: "identity",
                },
                "heatmap-radius": 40,
            },
        });

        map.addLayer({
            id: name+"_markers",
            source: name,
            type: "symbol",
            layout: {
                "icon-image": ["get", "icon"],
                "icon-size": 1,
                "icon-overlap": "always",
            },
        });

        map.on("click", name+"_markers", e => {
            marker_click(e);
        });
    }

    function set_map_product_data() {
        const product_name = product_select.value;
        const product = blahajData.data[product_name];
        document.getElementById("total-stores").textContent =
            product.length.toLocaleString("en-US");

        document.getElementById("total-blahaj").textContent =
            product.reduce((a, b) => a + b.quantity, 0).toLocaleString("en-US");

        for(const _product_name of product_names) {
            map.setLayoutProperty(
                _product_name+"_heatmap",
                "visibility",
                (layerVisibility["heatmap"] && product_select.value == _product_name) ? "visible" : "none",
            );

            map.setLayoutProperty(
                _product_name+"_markers",
                "visibility",
                (layerVisibility["markers"] && product_select.value == _product_name) ? "visible" : "none",
            );
        }
    }

    const product_select = document.getElementById("product-select");
    for(const product_name of product_names) {
        const opt = document.createElement("option");
        opt.innerText = product_name;
        opt.value = product_name;
        product_select.appendChild(opt);
        add_product(product_name);
    }
    product_select.onchange = (e) => {
        set_map_product_data();
    }
    set_map_product_data();

    for (const name of toggleableLayers) {
        const el = document.getElementById("show-" + name);
        el.checked = layerVisibility[name];
        el.addEventListener("change", e => {
            layerVisibility[name] = e.target.checked;
            set_map_product_data();
        });
    }
});

map.on("mouseenter", "markers", function () {
    map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", "markers", function () {
    map.getCanvas().style.cursor = "";
});
