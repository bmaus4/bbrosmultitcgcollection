import { format } from 'd3-format';

const TCG_APIS = {
    mtg: 'https://api.scryfall.com/cards/search?q=',
    pokemon: 'https://api.pokemontcg.io/v2/cards?q=name:',
    yugioh: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='
};

// --- SEARCH FUNCTIONS ---

export const searchCard = async (tcg, cardName) => {
    // For MTG, search for exact name to get all versions
    const query = tcg === 'mtg' ? `!"${cardName}"` : encodeURIComponent(cardName);
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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
    
    // Filter collection for relevant cards to avoid token limits
    // Only send first 50 rare/mythics that match color identity as a sample
    const collectionSample = collection
        .filter(c => c.rarity !== 'common' && c.rarity !== 'uncommon')
        .slice(0, 50)
        .map(c => c.name)
        .join(', ');

    let task = "";
    if (cardCount > 100) {
        task = `The deck has ${cardCount} cards (Limit 100). You MUST suggest exactly ${cardCount - 100} specific cuts to make the deck legal and optimized. Do NOT suggest additions.`;
    } else {
        task = `Suggest 3 specific card additions from the "Available Collection" below, and 3 cards to buy (Outside Collection) to improve the deck. Also suggest 3 weak cards to cut to make room.`;
    }

    const prompt = `Analyze this Magic: The Gathering deck.
    Format: ${activeDeck.format}
    Commander: ${commanderName}
    Cards: ${cardList}
    
    Available Collection (Sample): ${collectionSample}
    
    Task: ${task}
    
    1. Determine Power Level Bracket (Exhibition, Core, Upgraded, Optimized, or cEDH).
    2. Analyze consistency/win cons.
    
    IMPORTANT FORMATTING:
    - You MUST wrap ALL card names (both suggestions and cuts) in double brackets like this: [[Sol Ring]], [[Arcane Signet]].
    - Use HTML tags (<b>, <ul>, <li>) for structure.
    `;

    const response = await callGeminiAPI(prompt);
    if (!response) throw new Error("AI returned an empty analysis.");
    return response;
};

export const generateDeckWithGemini = async (collection, format, commander) => {
    const available = collection.map(c => `${c.quantity}x ${c.name}`).join('\n');
    
    let prompt = `Act as an expert MTG deck builder. Build a ${format} deck using ONLY the following available cards:
    ${available}
    
    Rules:
    - Format: ${format}
    ${commander ? `- Commander: ${commander.name} (Cards must match color identity)` : ''}
    - Standard: Max 4 copies.
    - Commander: Singleton (1 copy), 100 cards total.
    
    Return ONLY the decklist in "Quantity x Card Name" format. No intro text.`;

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
    
    Be concise. Cite rules if necessary. Use HTML for formatting. Wrap card names in [[brackets]] like [[Black Lotus]].`;

    const response = await callGeminiAPI(prompt);
    return response || "The Judge is silent.";
};

export const getKeywordDefinitions = async (keywords) => {
    // Local fallback to save API calls
    return keywords.map(k => ({ name: k, definition: "Keyword ability." }));
};
