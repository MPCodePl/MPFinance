

window.addEventListener("message", (event) => {
    if (event.data?.type !== "transactions") {
        return;
    }

    var transactionsPort = chrome.runtime.connect({ name: "transactions" });
    transactionsPort.postMessage({ transactions: event.data.transactions });
}, false);

let categories = [];
let transactions = [];

const port = chrome.runtime.connect({ name: "categories" });
port.postMessage({ });
port.onMessage.addListener(function(msg) {
	categories = msg.categories;
});
var changeCategoryPort = chrome.runtime.connect({ name: "changeCategory" });

chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type === 'transactions') {
            transactions = request.transactions.reduce((p, c) => [...p, ...c.transactions], []);
            updateStatuses();
        }
    }
);

function appendPaymentStatus() {
    const nodes = document.querySelectorAll('tr[class*=RowHeader__]');
	for (const node of nodes) {
		if (node.classList.contains("payment-row")) {
			continue;
		}
	
		node.classList.add("payment-row");
		const placeholder = node.querySelector("td div[class*=Box__] div[class*=Box__]");

		if (node.querySelector(".payment-status") != null) {
			continue;
		}

		const div = createStatus(node.id);
		placeholder.appendChild(div);
	}
}

function createStatus(rowId) {
	const div = document.createElement("div");
	div.classList.add("payment-status");
    
    const statusIcon = document.createElement("div");
    statusIcon.classList.add("status");
    div.appendChild(statusIcon);

    const categoryDiv = document.createElement("div");
    categoryDiv.classList.add("category");
    div.appendChild(categoryDiv);

    const select = document.createElement('select');
    for (const category of categories) {
        const option = document.createElement('option');
        option.value = category;
        option.text = category;
        select.appendChild(option)
    }
    select.addEventListener("change", function (event) { updateCategory(rowId, event); });

    categoryDiv.appendChild(select);

	return div;
}

function updateCategory(id, event) {
    const value = event.srcElement.value;
    changeCategoryPort.postMessage({ id, value });
}

function updateStatuses(event) {
    this.appendPaymentStatus();
    for (const transaction of transactions) {
        const paymentStatusDiv = document.querySelector(`#${transaction.id} .payment-status`);
        if (paymentStatusDiv == null) {
            continue;
        }

        paymentStatusDiv.querySelector(".status").classList.add("synced");
        paymentStatusDiv.querySelector(".category select").value = transaction.budget_category;
    }
}
