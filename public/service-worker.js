// Register event listener for the 'push' event.
self.addEventListener('push', function(event) {
    const data = event.data.json();
    let title = `${data.event}`;
    let body = `${JSON.stringify(data.data)}`;

    switch(data.event) {
        case "restock":
            const restock = data.data;
            const quantityAdd = restock.newStore.quantity - restock.oldStore?.quantity??0;
            title = `${restock.newStore.name} restocked ${restock.product}`;
            body = `they added ${quantityAdd} And now have ${restock.newStore.quantity} ${restock.product}`;
    }
    
    // Keep the service worker alive until the notification is created.
    event.waitUntil(
      // Show a notification with title 'ServiceWorker Cookbook' and body 'Alea iacta est'.
      // Set other parameters such as the notification language, a vibration pattern associated
      // to the notification, an image to show near the body.
      // There are many other possible options, for an exhaustive list see the specs:
      //   https://notifications.spec.whatwg.org/
      self.registration.showNotification(title, {
        lang: 'en',
        body: body,
        icon: 'img/marker-icons/original/marker1.png',
        vibrate: [500, 100, 500],
      })
    );
  });
