const TCG_APIS = {
    mtg: 'https://api.scryfall.com/cards/search?q=',
    pokemon: 'https://api.pokemontcg.io/v2/cards?q=name:',
    yugioh: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='
};

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
            // YGO API often returns multiple matches, we take the first page
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
            if (priceInfo.market) { // Only include rarities that have a price
                formattedPrices[rarity] = {
                    market: priceInfo.market,
                    // Estimate graded price
                    graded_10_est: priceInfo.market * (rarity.includes('Holofoil') || rarity.includes('Reverse') || rarity.includes('Secret') ? 5 : 3)
                };
            }
        });
    }

    return {
        id: card.id || '',
        name: card.name || 'Unknown Card',
        image_uris: { // Standardized format
            normal: card.images?.large || '',
            large: card.images?.large || '',
            art_crop: card.images?.large || '',
        },
        images: card.images || { small: '', large: '' }, // Keep original for version selection
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

export const getGeminiDeckAnalysis = async (activeDeck) => {
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("Gemini API key not found. Please add REACT_APP_GEMINI_API_KEY to your .env file.");
    }

    const cardList = activeDeck.cards.map(c => `${c.quantity}x ${c.name}`).join(', ');
    const prompt = `Analyze the following Magic: The Gathering deck list.
    Deck Name: ${activeDeck.name}
    Cards: ${cardList}
    
    Please provide a concise analysis covering:
    1.  **Overall Strategy & Win Conditions:** What is the main game plan?
    2.  **Key Card Synergies:** Which cards work particularly well together?
    3.  **Actionable Suggestions:** What are 2-3 specific cards that could be added to improve the deck and why?`;

    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`AI analysis failed: ${errorBody.error.message}`);
    }

    const result = await response.json();
    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        const text = result.candidates[0].content.parts[0].text;
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-indigo-300">$1</strong>')
            .replace(/\n/g, '<br />');
    } else {
        throw new Error("Could not get analysis. The response from the AI was empty or malformed.");
    }
};

export const generateDeckWithGemini = async (collection, format, commander) => {
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("Gemini API key not found.");
    }

    const availableCardsList = collection.map(c => `${c.quantity} x ${c.name}`).join('\n');

    let prompt = `You are an expert Magic: The Gathering deck builder simulating the EDHREC "Recs" engine. 
    Your goal is to build the most synergetic and powerful deck possible using ONLY the cards found in the "Available Cards" list below.

    Available Cards:
    ${availableCardsList}

    Format: ${format}
    `;

    if (format === 'commander') {
        if (!commander) throw new Error("A commander must be selected for Commander format.");
        prompt += `
        Commander: ${commander.name}
        Color Identity: ${commander.color_identity.join(', ')}
        
        **Deck Building Instructions:**
        1. **EDHREC Simulation**: Prioritize cards that have high synergy scores on EDHREC for ${commander.name}.
        2. **Rules**: Deck must be exactly 100 cards (including commander). Singleton format (except basic lands). Adhere strictly to color identity.
        3. **Structure**: Ensure a healthy balance of Lands (approx 33-38), Ramp, Draw, and Interaction.
        4. **Optimization**: Try to build the deck to at least "Upgraded" or "Optimized" bracket levels if the card pool allows.
        `;
    } else { // Standard
        prompt += `
        Deck Building Rules for Standard:
        1. The deck must contain at least 60 cards.
        2. With the exception of basic lands, a maximum of 4 copies of any card are allowed.
        3. Focus on meta-relevant strategies if cards allow.
        `;
    }

    prompt += `
    **Output Format:**
    Return ONLY the decklist in the format "Quantity x Card Name", with each card on a new line. Do not include any other text, intros, or outros.
    Example:
    1 x Sol Ring
    1 x Arcane Signet
    ...
    `;
    
    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`AI deck generation failed: ${errorBody.error.message}`);
    }

    const result = await response.json();
    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        return result.candidates[0].content.parts[0].text;
    } else {
        throw new Error("The AI did not return a valid response.");
    }
};

export const askMtgRules = async (question, contextCards = []) => {
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("Gemini API key not found.");
    }

    let cardContextString = "";
    if (contextCards.length > 0) {
        cardContextString = "\n\n**Reference Cards (Official Oracle Text):**\n" + 
            contextCards.map(c => `--- ${c.name} ---\n${c.type_line}\n${c.oracle_text}`).join('\n\n');
    }

    const prompt = `You are a Level 3 Magic: The Gathering Judge and rules expert. 
    You are answering a specific rules question.
    
    User Question: "${question}"

    ${cardContextString}

    Instructions:
    1. Explain the interaction clearly and concisely using the stack, priority, and layers where relevant.
    2. Cite specific Comprehensive Rules (CR) numbers if applicable to solidify your ruling.
    3. If there are newer cards involved, prioritize the Oracle Text provided in the "Reference Cards" section above.
    4. Be definitive: "Yes, that works" or "No, the trigger fizzles."
    5. Format with Markdown for readability (bold key terms, use bullet points).
    `;

    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`Rules check failed: ${errorBody.error.message}`);
    }

    const result = await response.json();
    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        const text = result.candidates[0].content.parts[0].text;
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-indigo-300">$1</strong>')
            .replace(/\n/g, '<br />');
    } else {
        throw new Error("The Judge is silent (AI response empty).");
    }
};

export const getKeywordDefinitions = async (keywords) => {
    const definitions = [];
    for (const keyword of keywords) {
        try {
            const response = await fetch(`https://api.scryfall.com/catalog/keyword-abilities`);
            const data = await response.json();
            const definition = data.data.find(d => d.toLowerCase() === keyword.toLowerCase());
            if (definition) {
                 definitions.push({ name: keyword, definition: getLocalKeywordDefinition(keyword) });
            }
        } catch (error) {
            console.warn(`Could not fetch definition for ${keyword}`, error);
        }
    }
    return definitions;
};

function getLocalKeywordDefinition(keyword) {
    const commonKeywords = {
        'deathtouch': 'Any amount of damage this deals to a creature is enough to destroy it.',
        'defender': 'This creature can\'t attack.',
        'double strike': 'This creature deals both first-strike and regular combat damage.',
        'enchant': 'Attach to a permanent. You control the enchanted permanent.',
        'equip': 'Attach to target creature you control. Equip only as a sorcery.',
        'first strike': 'This creature deals combat damage before creatures without first strike.',
        'flash': 'You may cast this spell any time you could cast an instant.',
        'flying': 'This creature can\'t be blocked except by creatures with flying or reach.',
        'haste': 'This creature can attack and use activated abilities as soon as it comes under your control.',
        'hexproof': 'This permanent or player can\'t be the target of spells or abilities your opponents control.',
        'indestructible': 'Effects that say "destroy" don\'t destroy this permanent. It can\'t be destroyed by damage.',
        'lifelink': 'Damage dealt by this creature also causes you to gain that much life.',
        'menace': 'This creature can\'t be blocked except by two or more creatures.',
        'reach': 'This creature can block creatures with flying.',
        'trample': 'This creature can deal excess combat damage to the player or planeswalker it\'s attacking.',
        'vigilance': 'Attacking doesn\'t cause this creature to tap.',
        'infect': 'This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.',
        'populate': 'Create a token that\'s a copy of a creature token you control.',
    };
    return commonKeywords[keyword.toLowerCase()] || 'No definition available.';
}
