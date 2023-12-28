window.fetch = new Proxy(window.fetch, {
	apply: function (target, that, args) {
		let temp = target.apply(that, args);
		temp.then((res) => {
			if (res.url == 'https://secure.velobank.pl/api/v004/Transfers/history') {
				res
					.clone()
					.json()
					.then(body => handleInterceptedTransactions(body));
			}
			if (res.status === 401) {
				alert("Session expired, please reload the page!");
			}
		});
		return temp;
	},
});

function handleInterceptedTransactions(body) {
	const transactions = body.list;
	window.postMessage({ transactions, type: 'transactions' });
}
