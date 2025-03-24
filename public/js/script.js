// public/js/script.js
let isProcessing = false;
let currentCards = [];
let processingIndex = 0;

document.getElementById('startBtn').addEventListener('click', async () => {
    if (isProcessing) return;
    
    const lista = document.getElementById('lista').value;
    const cookie = document.getElementById('cookie').value;
    currentCards = lista.split('\n').filter(c => c.trim());
    
    if (currentCards.length === 0 || !cookie.trim()) return;
    
    isProcessing = true;
    processingIndex = 0;
    updateButtonStates();
    await processCards();
});

document.getElementById('stopBtn').addEventListener('click', () => {
    isProcessing = false;
    updateButtonStates();
});

document.getElementById('cleanBtn').addEventListener('click', () => {
    document.getElementById('lista').value = '';
    document.getElementById('cookie').value = '';
});

document.getElementById('confirmClean').addEventListener('click', () => {
    document.querySelectorAll('.results-container').forEach(container => {
        container.innerHTML = '';
    });
    updateCounters();
    $('#confirmModal').modal('hide');
});

async function processCards() {
    while (processingIndex < currentCards.length && isProcessing) {
        const card = currentCards[processingIndex];
        updateTextarea();
        
        try {
            const response = await fetch('/check', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({lista: card.trim(), cookie: document.getElementById('cookie').value.trim()})
            });

            const result = await response.json();
            appendResult(result);
        } catch (error) {
            handleError(card);
        }
        
        processingIndex++;
    }
    
    isProcessing = false;
    updateButtonStates();
}

function updateTextarea() {
    const remainingCards = currentCards.slice(processingIndex + 1);
    document.getElementById('lista').value = remainingCards.join('\n');
}

function appendResult(result) {
    const resultElement = document.createElement('div');
    resultElement.className = 'result-item';
    resultElement.textContent = `${result.data}`;
    
    document.getElementById(result.status === 'aprovada' ? 'aprovadas' : 
                             result.status === 'reprovada' ? 'reprovadas' : 'errores')
                             .appendChild(resultElement);
    updateCounters();
}

function updateButtonStates() {
    document.getElementById('startBtn').disabled = isProcessing;
    document.getElementById('stopBtn').disabled = !isProcessing;
}

function updateCounters() {
    const counters = {
        aprovadas: document.getElementById('aprovadas').childElementCount,
        reprovadas: document.getElementById('reprovadas').childElementCount,
        errores: document.getElementById('errores').childElementCount
    };
    
    Object.entries(counters).forEach(([key, value]) => {
        document.getElementById(`${key}-contador`).textContent = value;
    });
}