let globalCategories = [];
let fetchedTransactions = [];
let automatedRules = [];
let userToken = null;
let senderTabId = null;

const SPREED_SHEET_ID = '1O6eFkOSqSaPtxxeYftDjUyvAj5BoajqCvCoU-quUv3E';

chrome.runtime.onConnect.addListener(function(port) {
    if (port.name === 'categories') {
        senderTabId = port.sender.tab.id;
        port.postMessage({ categories: globalCategories });
    }
});

chrome.identity.getAuthToken({ interactive: true }, token =>
    {
        if ( chrome.runtime.lastError || ! token ) {
            console.log(`SSO ended with an error: ${JSON.stringify(chrome.runtime.lastError)}`)
        }

        fetchCategories(token).then(categories => {
            globalCategories = categories;
        });

        fetchAutomatedRules(token).then(rules => {
            automatedRules = rules;
        });
    });

function fetchCategories(token) {
    userToken = token;
    return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREED_SHEET_ID}/values/Kategorie!A:A`, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(obj => {
        return obj.json();
    }).then(obj => {
        return obj.values.reduce((p, c) => [...p, c[0]], []);
    })
}

function fetchAutomatedRules(token) {
    userToken = token;
    return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREED_SHEET_ID}/values/Automatyzacja!A:C`, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(obj => {
        return obj.json();
    }).then(obj => {
        return obj.values.slice(1).reduce((p, c) => [...p, parseAutomatedRuleFromSheet(c)], []).filter(r => r != null);
    })
}

chrome.runtime.onConnect.addListener(function(port) {
	if (port.name === 'transactions') {
        port.onMessage.addListener(function(msg) {
            syncTransactions(msg.transactions);
        });
    }
});

chrome.runtime.onConnect.addListener(function(port) {
	if (port.name === 'changeCategory') {
        port.onMessage.addListener(function(msg) {
            updateCategory(msg.id, msg.value);
        });
    }
});

async function syncTransactions(transactions) {
    const parsedTransactions = transactions.map(t => parseTransactionFromBank(t));
    const transactionDates = parsedTransactions.reduce((p, c) => {
        const transactionDate = getTransactionDate(c);
        return p.some(x => x.month === transactionDate.month && x.year === transactionDate.year) ? p : [...p, transactionDate];
    }, []);

    for (const date of transactionDates) {
        await fetchTransactions(date);
        const transactionsToSync = parsedTransactions.filter(t => t.date.startsWith(`${date.year}-${date.month <= 9 ? '0' : ''}${date.month}`));
        updateIdForExistingTransaction(date, transactionsToSync);
        const missingTransactions = filterMissingTransactions(date, transactionsToSync);
        if (missingTransactions.length > 0) {
            console.log(`Syncing ${missingTransactions.length} transactions`)
            await addMissingTransactions(date, missingTransactions);
            await fetchTransactionsFromDate(date);
        }
        else {
            console.log("No transactions to sync");
        }
    }

    await chrome.tabs.sendMessage(senderTabId, { transactions: fetchedTransactions, type: 'transactions' });
}

async function fetchTransactions(date) {
    if (fetchedTransactions.some(t => t.date.year === date.year && t.date.month === date.month)) {
        return;
    }

    await fetchTransactionsFromDate(date);
}

async function fetchTransactionsFromDate(date) {
    const cells = encodeURI(`'${date.year}-${date.month}'!A:X`);

    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREED_SHEET_ID}/values/${cells}`, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + userToken
        }
    })
    const savedTransactions = await response.json();
    if (savedTransactions.values != null) {
        fetchedTransactions = fetchedTransactions.filter(t => t.date.month !== date.month && t.date.year !== date.year).concat([{
            date,
            transactions: savedTransactions.values.slice(1).map(t => parseTransactionFromSheet(t)).filter(t => t != null),
        }]);
    }
    
}

async function addMissingTransactions(date, transactions) {
    const currentTransactions = fetchedTransactions.find(t => t.date.month === date.month && t.date.year === date.year);
    const currentLastIndex = currentTransactions.transactions.length + 2;
    const lastIndex = currentLastIndex + transactions.length;
    const parsedTransactions = transactions.map((t, i) => parseTransactionToSheet(t, currentLastIndex + i - 1));
    const range = `'${date.year}-${date.month}'!A${currentLastIndex}:X${lastIndex}`;
    const rangeUri = encodeURI(range);

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREED_SHEET_ID}/values/${rangeUri}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + userToken
        },
        body: JSON.stringify({
            majorDimension: "ROWS",
            range,
            values: parsedTransactions,
        }),
    });
}

async function updateCategory(id, category) {
    const allTransactions = fetchedTransactions.reduce((p, c) => p.concat(c.transactions), []);
    const affectedTransaction = allTransactions.find(t => t.id === id);
    await updateCategoryInSheet(affectedTransaction.internal_id, getTransactionDate(affectedTransaction), category);
    affectedTransaction.budget_category = category;
}

async function updateCategoryInSheet(internal_id, date, category) {
    const range = `'${date.year}-${date.month}'!X${+internal_id + 1}`;
    const rangeUri = encodeURI(range);

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREED_SHEET_ID}/values/${rangeUri}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + userToken
        },
        body: JSON.stringify({
            majorDimension: "ROWS",
            range,
            values: [[category]],
        }),
    });
}

function filterMissingTransactions(date, transactionsToSync) {
    const currentTransactions = fetchedTransactions.find(t => t.date.month === date.month && t.date.year === date.year).transactions;
    return transactionsToSync.filter(t => !currentTransactions.some(c => isSameTransaction(t, c)));
}

function updateIdForExistingTransaction(date, transactionsToSync) {
    const currentTransactions = fetchedTransactions.find(t => t.date.month === date.month && t.date.year === date.year).transactions;
    for (const transaction of transactionsToSync) {
        const existingTransaction = currentTransactions.find(c => isSameTransaction(transaction, c));
        if (existingTransaction == null) {
            continue;
        }

        existingTransaction.id = transaction.id;
    }
}

function isSameTransaction(left, right) {
    return left.amount === right.amount && left.date === right.date && left.title === right.title;
}

function parseTransactionToSheet(transaction, index) {
    return [
        index,
        transaction.accounting_date,
        transaction.amount,
        transaction.currency,
        transaction.amount_pln,
        transaction.balance,
        transaction.card_number,
        transaction.card_provider,
        transaction.category,
        transaction.date,
        transaction.id,
        transaction.id_product,
        transaction.merchant_name,
        transaction.merchant_city,
        transaction.merchant_country_code,
        transaction.recipient_name,
        transaction.operation_type,
        transaction.permitted_operations?.join(','),
        transaction.remitter_display_name,
        transaction.remitter_name,
        transaction.side,
        transaction.status,
        transaction.title,
        transaction.budget_category,
    ]
}

function parseTransactionFromBank(transaction) {
    const result = {
        internal_id: "",
        accounting_date: transaction.date,
        amount: +(transaction.operation_type === 'TRANSFER_IN' ? transaction.amount?.amount : `-${transaction.amount?.amount}`),
        currency: transaction.amount?.currency,
        amount_pln: +(transaction.operation_type === 'TRANSFER_IN' ? transaction.amount_pln?.amount : `-${transaction.amount_pln?.amount}`),
        balance: transaction.balance?.amount != null ? +transaction.balance?.amount : null,
        card_number: transaction.card_number,
        card_provider: transaction.card_provider,
        category: transaction.category,
        date: transaction.date,
        id: transaction.id,
        id_product: transaction.id_product,
        merchant_name: transaction.merchant?.name,
        marchant_city: transaction.merchant?.city,
        merchant_country_code: transaction.merchant?.country_code,
        recipient_name: transaction.recipient?.name,
        operation_type: transaction.operation_type,
        permitted_operations: transaction.permitted_operations,
        remitter_display_name: transaction.remitter?.display_name,
        remitter_name: transaction.remitter?.name,
        side: transaction.side,
        status: transaction.status,
        title: transaction.title,
        budget_category: "Brak",
    }
    assignCategory(result);
    return result;
}

function assignCategory(transaction) {
    const assignedCategory = automatedRules.find(a => matchRule(a, transaction));
    transaction.budget_category = assignedCategory?.category ?? "Brak";
}

function matchRule(rule, transaction) {
    if ((rule.titleRule != null && rule.titleRule !== "") && new RegExp(rule.titleRule).test(transaction.title)) {
        return true;
    }

    if ((rule.targetNameRule != null && rule.targetNameRule !== "") && new RegExp(rule.targetNameRule).test(transaction.merchant_name)) {
        return true;
    }

    if ((rule.targetNameRule != null && rule.targetNameRule !== "") && new RegExp(rule.targetNameRule).test(transaction.recipient_name)) {
        return true;
    }

    return false;
}

function parseTransactionFromSheet(transaction) {
    if (transaction.length !== 24) {
        return null;
    }

    return {
        internal_id: transaction[0],
        accounting_date: transaction[1],
        amount: +transaction[2],
        currency: transaction[3],
        amount_pln: +transaction[4],
        balance: transaction[5] !== "" ? +transaction[5] : null,
        card_number: transaction[6],
        card_provider: transaction[7],
        category: transaction[8],
        date: transaction[9],
        id: transaction[10],
        id_product: transaction[11],
        merchant_name: transaction[12],
        marchant_city: transaction[13],
        merchant_country_code: transaction[14],
        recipient_name: transaction[15],
        operation_type: transaction[16],
        permitted_operations: transaction[17]?.split(',') ?? [],
        remitter_display_name: transaction[18],
        remitter_name: transaction[19],
        side: transaction[20],
        status: transaction[21],
        title: transaction[22],
        budget_category: transaction[23],
    }
}

function parseAutomatedRuleFromSheet(automatedRule) {
    if (automatedRule[0] === "" || automatedRule[0] == null) {
        return null;
    }

    return {
        category: automatedRule[0],
        titleRule: automatedRule[1],
        targetNameRule: automatedRule[2],
    }
}

function getTransactionDate(transaction) {
    const dates = transaction.date.split("-");
    return {
        month: +dates[1],
        year: +dates[0],
    }
}
