const TCG_APIS = {
    mtg: 'https://api.scryfall.com/cards/search?q=',
    pokemon: 'https://api.pokemontcg.io/v2/cards?q=name:',
    yugioh: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='
};

// --- SEARCH FUNCTIONS ---

export const searchCard = async (tcg, cardName) => {
    const query = tcg === 'mtg' ? `!"${cardName}"+unique:prints` : encodeURIComponent(cardName);
    const url = `${TCG_APIS[tcg]}${query}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Card not found in ${tcg.toUpperCase()} database.`);
    }
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) throw new Error('Card not found.');

    switch (tcg) {
        case 'mtg':
            return data.data.map(normalizeMtgData);
        case 'pokemon':
            return data.data.map(normalizePokemonData);
        case 'yugioh':
            return data.data.map(normalizeYugiohData);
        default:
            throw new Error('Unsupported TCG');
    }
};

const normalizeMtgData = (card) => ({
    ...card,
    id: card.id || '',
    name: card.name || 'Unknown Card',
    type_line: card.type_line || '',
    oracle_text: card.oracle_text || '',
    image_uris: card.image_uris || { normal: '', large: '', art_crop: '' },
    set: { name: card.set_name || 'N/A' },
    color_identity: card.color_identity || [],
    keywords: card.keywords || [],
    cmc: card.cmc || 0,
    prices: card.prices,
    ungraded_price: parseFloat(card.prices?.usd) || 0,
});

const normalizePokemonData = (card) => {
    const prices = card.tcgplayer?.prices;
    const formattedPrices = {};
    let marketPrice = 0;

    if (prices) {
        const priceKeys = Object.keys(prices);
        const unlimitedKey = priceKeys.find(k => k === 'unlimited' || k === '1stEdition' || k.includes('normal'));
        const firstKey = unlimitedKey || priceKeys[0];
        
        if (firstKey && prices[firstKey]?.market) {
            marketPrice = prices[firstKey].market;
        }

        Object.keys(prices).forEach(rarity => {
            const priceInfo = prices[rarity] || {};
            if (priceInfo.market) {
                formattedPrices[rarity] = {
                    market: priceInfo.market,
                    graded_10_est: priceInfo.market * (rarity.includes('Holofoil') || rarity.includes('Reverse') ? 5 : 3)
                };
            }
        });
    }

    return {
        id: card.id || '',
        name: card.name || 'Unknown Card',
        image_uris: {
            normal: card.images?.large || '',
            large: card.images?.large || '',
            art_crop: card.images?.large || '',
        },
        images: card.images || { small: '', large: '' },
        type_line: `${card.supertype || ''} - ${card.subtypes?.join(', ') || ''}`,
        rarity: card.rarity || 'Common',
        oracle_text: card.rules?.join('\n') || '',
        prices: formattedPrices,
        ungraded_price: marketPrice,
        set: card.set || { name: 'N/A', id: '' },
        number: card.number || '',
        types: card.types || [],
        evolvesFrom: card.evolvesFrom || null,
    };
};

const normalizeYugiohData = (card) => {
    return {
        id: card.id || '',
        name: card.name || 'Unknown Card',
        image_uris: {
            normal: card.card_images?.[0]?.image_url || '',
            large: card.card_images?.[0]?.image_url || '',
            art_crop: card.card_images?.[0]?.image_url_cropped || '',
        },
        type_line: card.type || '',
        race: card.race || '',
        oracle_text: card.desc || '',
        atk: card.atk !== undefined ? card.atk : null,
        def: card.def !== undefined ? card.def : null,
        set: { name: card.card_sets?.[0]?.set_name || 'N/A' },
        prices: card.card_prices?.[0] || {},
        ungraded_price: parseFloat(card.card_prices?.[0]?.tcgplayer_price) || 0,
    };
};

// --- AI FUNCTIONS ---

const callGeminiAPI = async (prompt) => {
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API Key missing. Please check your .env or Netlify settings.");

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }]
    };

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gemini Error: ${errorData.error?.message || response.statusText}`);
    }

    const result = await response.json();
    return result.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

export const getGeminiDeckAnalysis = async (activeDeck, collection) => {
    const cardCount = activeDeck.cards.reduce((acc, c) => acc + c.quantity, 0);
    const cardList = activeDeck.cards.map(c => `${c.quantity}x ${c.name}`).join(', ');
    const commanderName = activeDeck.commander ? activeDeck.commander.name : "None";
    
    // Sample collection for recommendations
    const collectionSample = collection
        .filter(c => !activeDeck.cards.find(dc => dc.name === c.name)) // Exclude cards already in deck
        .filter(c => c.rarity === 'rare' || c.rarity === 'mythic')
        .slice(0, 60)
        .map(c => c.name)
        .join(', ');

    let taskInstruction = "";
    if (cardCount > 100 && activeDeck.format === 'commander') {
        taskInstruction = `The deck has ${cardCount} cards (Limit 100). Suggest exactly ${cardCount - 100} cuts to make it legal. Do NOT suggest additions.`;
    } else {
        taskInstruction = `
        1. Suggest 3-5 specific card additions from the "Available Collection" below.
        2. Suggest 3-5 cards to buy (Outside Collection) that are high synergy.
        3. For every addition, suggest a specific cut to maintain the deck size.
        If the collection sample has no good cards, state "No better cards in collection."`;
    }

    const prompt = `Analyze this Magic: The Gathering deck.
    Format: ${activeDeck.format}
    Commander: ${commanderName}
    Cards: ${cardList}
    
    Available Collection Sample: ${collectionSample}
    
    Task: ${taskInstruction}
    
    Also:
    - Determine Power Level Bracket (Exhibition, Core, Upgraded, Optimized, cEDH).
    - Analyze consistency and win cons.
    
    CRITICAL FORMATTING:
    - Return ONLY valid HTML (using <h3>, <ul>, <li>, <strong>, <p>). Do NOT use Markdown (no ###, no **).
    - Wrap EVERY card name in double brackets like [[Sol Ring]] to enable preview hovers.
    `;

    const response = await callGeminiAPI(prompt);
    if (!response) throw new Error("AI returned an empty analysis.");
    return response;
};

export const generateDeckWithGemini = async (collection, format, commander) => {
    const available = collection.map(c => `${c.quantity}x ${c.name}`).join('\n');
    
    let prompt = `Act as an EDHREC-powered deck builder. Build the best possible ${format} deck for ${commander ? commander.name : 'the chosen format'} using ONLY the following available cards:
    ${available}
    
    Rules:
    - Commander: Singleton, 100 cards total (if possible), strict color identity.
    - Strategy: Maximize synergy, ramp, and draw based on EDHREC top stats.
    
    Output Format:
    Return the response in two distinct sections separated by exactly "---SPLIT---".
    
    Section 1: The Decklist
    - Format: "Quantity x Card Name" (one per line).
    - ONLY use cards from the provided list.
    - If you run out of good cards (e.g. only reach 70 cards), STOP. Do not add bad cards just to fill space.
    
    Section 2: Recommendations
    - If the deck is incomplete (<100 cards), suggest specific cards to buy to finish it.
    - Explain the general strategy.
    - Return this section as valid HTML (<h3>, <ul>, <li>, <p>). Wrap card names in [[brackets]].
    `;

    const response = await callGeminiAPI(prompt);
    if (!response) throw new Error("AI could not generate a deck.");
    return response;
};

export const askMtgRules = async (question, contextCards = []) => {
    let context = "";
    if (contextCards.length > 0) {
        context = "Reference Card Text:\n" + contextCards.map(c => `${c.name}: ${c.oracle_text}`).join('\n\n');
    }

    const prompt = `You are a Level 3 Magic Judge. Answer this rule question: "${question}"
    ${context}
    
    Be concise. Cite rules if necessary. Return valid HTML (no Markdown). Wrap card names in [[brackets]].`;

    const response = await callGeminiAPI(prompt);
    return response || "The Judge is silent.";
};

export const getKeywordDefinitions = async (keywords) => {
    return keywords.map(k => ({ name: k, definition: "Keyword ability." }));
};
