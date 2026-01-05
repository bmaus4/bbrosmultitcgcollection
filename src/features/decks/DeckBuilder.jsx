import React, { useState, useMemo, useEffect } from 'react';
import { X, PlusCircle, Trash2, BrainCircuit, MinusCircle, CheckCircle, Crown, Wand2, ChevronsUpDown } from 'lucide-react';
import { Modal, Spinner, CardDetailModal, CardHoverLink } from '../../components/Shared';
import { getGeminiDeckAnalysis, generateDeckWithGemini } from '../../services/api';

// Re-defining CardDisplay here to include deck controls
const CardDisplayWithControls = ({ card, onCardClick, deckControls }) => (
    <div className="bg-gray-800/50 rounded-lg overflow-hidden shadow-lg border border-gray-700 hover:border-indigo-500 transition-all duration-300 transform hover:-translate-y-1 group relative backdrop-blur-sm">
        <img
            src={card.image_uris?.normal || `https://placehold.co/600x838/1f2937/7c3aed?text=${encodeURIComponent(card.name)}`}
            alt={card.name}
            className="w-full h-auto transition-transform duration-300 group-hover:scale-105 cursor-pointer"
            onClick={() => onCardClick(card)}
            onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/600x838/1f2937/7c3aed?text=No+Image`; }}
        />
        <div className="absolute top-1 right-1 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
            x{card.available}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-none">
            <h3 className="font-bold text-white truncate text-sm">{card.name}</h3>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
            <button onClick={deckControls.remove} disabled={deckControls.inDeck <= 0} className="p-2 bg-red-600 rounded-full text-white disabled:bg-gray-600"><MinusCircle size={20} /></button>
            <span className="text-white font-bold text-lg">{deckControls.inDeck}</span>
            <button onClick={deckControls.add} disabled={deckControls.available <= 0} className="p-2 bg-green-600 rounded-full text-white disabled:bg-gray-600"><PlusCircle size={20} /></button>
        </div>
    </div>
);

const DeckValidation = ({ deck, tcg }) => {
    if (!deck || tcg !== 'mtg') return null;

    const cardCount = deck.cards.reduce((acc, c) => acc + c.quantity, 0);

    const rules = {
        standard: [
            { label: `At least 60 cards`, valid: cardCount >= 60 },
            { label: 'Max 4 copies of each card (non-basic)', valid: deck.cards.every(c => c.type_line.includes('Basic Land') || c.quantity <= 4) },
        ],
        commander: [
            { label: 'Exactly 100 cards', valid: cardCount === 100 },
            { label: 'Commander is a legendary creature', valid: !!deck.commander && deck.commander.type_line.includes('Legendary') && deck.commander.type_line.includes('Creature') },
            { label: 'Singleton format', valid: deck.cards.every(c => c.quantity === 1 || c.type_line.includes('Basic Land') || c.oracle_text?.toLowerCase().includes("a deck can have any number of cards named"))},
            { label: 'Color Identity', valid: deck.cards.every(c => c.color_identity.every(color => deck.commander?.color_identity.includes(color))) },
        ]
    };

    const formatRules = rules[deck.format] || [];
    
    return (
        <div className="bg-gray-700/50 p-4 rounded-lg">
            <h4 className="font-bold text-indigo-300 mb-2">Deck Validation ({deck.format})</h4>
            <ul className="space-y-1 text-sm">
                {formatRules.map(rule => (
                    <li key={rule.label} className="flex items-center gap-2">
                        {rule.valid ? <CheckCircle className="text-green-400" size={16}/> : <X className="text-red-400" size={16}/>}
                        <span className={rule.valid ? 'text-gray-300' : 'text-red-400'}>{rule.label}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const DeckBuilder = ({ tcg, config, collection, decks, setDecks, activeDeckId, setActiveDeckId, showMessage }) => {
    const [newDeckModalOpen, setNewDeckModalOpen] = useState(false);
    const [aiGenerateModalOpen, setAIGenerateModalOpen] = useState(false);
    const [commanderModalOpen, setCommanderModalOpen] = useState(false);
    const [analysis, setAnalysis] = useState({ isOpen: false, result: '', isAnalyzing: false });
    const [confirmDelete, setConfirmDelete] = useState({ isOpen: false, deckId: null });
    const [selectedCard, setSelectedCard] = useState(null);
    const [aiRecommendations, setAiRecommendations] = useState(null);

    // Sorting & Filtering State
    const [filters, setFilters] = useState({});
    const [sort, setSort] = useState({ field: 'name', direction: 'asc' });

    const activeDeck = useMemo(() => decks.find(d => d.id === activeDeckId), [decks, activeDeckId]);

    const handleCreateDeck = (name, format) => {
        const newDeck = { id: Date.now().toString(), name, format, cards: [], commander: null };
        setDecks([...decks, newDeck]);
        setActiveDeckId(newDeck.id);
        setNewDeckModalOpen(false);
    };

    const updateCardInDeck = (card, quantityChange) => {
        if (!activeDeck) return;
        setDecks(decks.map(deck => {
            if (deck.id === activeDeckId) {
                const updatedCards = [...deck.cards];
                const cardIndex = updatedCards.findIndex(c => c.id === card.id);
                if (cardIndex > -1) {
                    updatedCards[cardIndex].quantity += quantityChange;
                    if (updatedCards[cardIndex].quantity <= 0) updatedCards.splice(cardIndex, 1);
                } else if (quantityChange > 0) {
                    updatedCards.push({ ...card, quantity: 1 });
                }
                return { ...deck, cards: updatedCards };
            }
            return deck;
        }));
    };
    
    const performDelete = () => {
        if (confirmDelete.deckId) {
            setDecks(decks.filter(d => d.id !== confirmDelete.deckId));
            if (activeDeckId === confirmDelete.deckId) setActiveDeckId(null);
            setConfirmDelete({ isOpen: false, deckId: null });
        }
    };

    // Filter Logic - Updated to include keywords
    const filteredCollection = useMemo(() => {
        let items = [...collection];
        Object.entries(filters).forEach(([key, value]) => {
            if (!value) return;
            const lowerCaseValue = value.toLowerCase();
            if (key === 'name') items = items.filter(c => c.name.toLowerCase().includes(lowerCaseValue));
            if (key === 'type') {
                if (tcg === 'pokemon') items = items.filter(c => c.types?.includes(value));
                if (tcg === 'mtg') items = items.filter(c => c.type_line?.toLowerCase().includes(lowerCaseValue));
            }
            if (key === 'color' && tcg === 'mtg') {
                 items = items.filter(c => c.color_identity && c.color_identity.includes(value));
            }
            if (key === 'keyword' && tcg === 'mtg') {
                items = items.filter(c => c.keywords && c.keywords.some(k => k.toLowerCase().includes(lowerCaseValue)));
            }
        });

        items.sort((a, b) => {
            if (sort.field === 'name') return a.name.localeCompare(b.name);
            if (sort.field === 'cmc') return (a.cmc || 0) - (b.cmc || 0);
            return 0;
        });

        if (sort.direction === 'desc') items.reverse();
        
        const deckCounts = activeDeck?.cards.reduce((acc, c) => ({...acc, [c.id]: c.quantity}), {}) || {};
        return items.map(c => ({
            ...c, 
            available: c.quantity - (deckCounts[c.id] || 0),
            inDeck: deckCounts[c.id] || 0
        }));

    }, [collection, filters, sort, tcg, activeDeck]);

    const handleFilterChange = (e) => setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const analyzeDeck = async () => {
        if (!activeDeck || activeDeck.cards.length === 0) {
            showMessage("Please select a deck with cards to analyze.", 'error');
            return;
        }
        setAnalysis({ isOpen: true, result: '', isAnalyzing: true });
        try {
            const result = await getGeminiDeckAnalysis(activeDeck, collection);
            setAnalysis(prev => ({ ...prev, result }));
        } catch (error) {
            setAnalysis(prev => ({ ...prev, result: `Error: ${error.message}` }));
        } finally {
            setAnalysis(prev => ({ ...prev, isAnalyzing: false }));
        }
    };
    
    // Updated Helper to render AI Text with HTML injection
    const renderAiText = (htmlString) => {
        if (!htmlString) return null;
        // Basic sanitization if needed, but we trust the AI output for now.
        // We split by the regex for [[Card Name]] to inject components.
        // Since we asked for HTML, we need to handle both HTML tags and our custom brackets.
        
        // Strategy: Render the whole thing as HTML, but replace the [[Brackets]] text 
        // with the component logic? React dangerouslySetInnerHTML doesn't allow components inside.
        // Better approach: Parse the HTML structure or just rely on text parsing for links.
        // For simplicity and robustness here: We will rely on text replacement before rendering.
        
        // Actually, mixing React components into HTML string is hard. 
        // Let's do a simple split and render. The HTML tags will be rendered as text if we don't use dangerousHTML.
        // Let's use dangerousHTML but pre-process the string to replace [[Card]] with a span we can hydrate?
        // No, that's too complex.
        
        // Simple approach: We split by [[ ]] and render. HTML tags inside those splits will be text.
        // This is a limitation. To get BOTH HTML formatting AND React Components, we need a parser.
        // For this version, let's prioritize the CARD LINKS.
        
        const parts = htmlString.split(/(\[\[.*?\]\])/g);
        return parts.map((part, i) => {
            if (part.startsWith('[[') && part.endsWith(']]')) {
                const name = part.slice(2, -2);
                return <CardHoverLink key={i} name={name} />;
            }
            // Use dangerouslySetInnerHTML for the HTML parts from AI
            return <span key={i} dangerouslySetInnerHTML={{ __html: part }} />;
        });
    };

    const handleAIGenerateDeck = async (format, commander) => {
        showMessage('The AI is building your deck... this may take a moment.', 'info');
        setAiRecommendations(null); // Clear previous recommendations
        try {
            const fullResponse = await generateDeckWithGemini(collection, format, commander);
            
            // Split response
            const [decklistPart, recommendationsPart] = fullResponse.split('---SPLIT---');

            const cardsForNewDeck = [];
            const lines = decklistPart.trim().split('\n');
            lines.forEach(line => {
                const match = line.match(/^(\d+)\s*x\s*(.*)/i);
                if (match) {
                    const quantity = parseInt(match[1], 10);
                    const name = match[2].trim();
                    const cardFromCollection = collection.find(c => c.name.toLowerCase() === name.toLowerCase());
                    if (cardFromCollection) {
                        cardsForNewDeck.push({ ...cardFromCollection, quantity });
                    }
                }
            });

            if (cardsForNewDeck.length === 0) throw new Error("The AI did not return a valid decklist.");

            const newDeckName = commander ? `${commander.name}'s AI Deck` : `AI Generated ${format} Deck`;
            const newDeck = { id: Date.now().toString(), name: newDeckName, format, cards: cardsForNewDeck, commander };
            setDecks(prev => [...prev, newDeck]);
            setActiveDeckId(newDeck.id);
            
            // If there are recommendations, show them
            if (recommendationsPart && recommendationsPart.trim().length > 0) {
                setAiRecommendations(recommendationsPart.trim());
            }

            showMessage(`Successfully generated "${newDeckName}"!`, 'success');
        } catch (error) {
            console.error("AI Deck Generation Error:", error);
            showMessage(error.message, 'error');
        }
    };

    const setCommander = (card) => {
        if (!card.type_line.includes('Legendary') || !card.type_line.includes('Creature')) {
            showMessage('Commander must be a legendary creature.', 'error');
            return;
        }
        const updatedDecks = decks.map(d => d.id === activeDeckId ? {...d, commander: card} : d);
        setDecks(updatedDecks);
        setCommanderModalOpen(false);
    };

    const legendaryCreatures = useMemo(() => collection.filter(c => c.type_line.includes("Legendary") && c.type_line.includes("Creature")), [collection]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[85vh]">
            <div className="lg:col-span-1 space-y-4 flex flex-col h-full">
                 <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex gap-2 mb-2">
                        <select value={activeDeckId || ''} onChange={e => setActiveDeckId(e.target.value)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white">
                            <option value="">-- Select Deck --</option>
                            {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name} ({deck.format})</option>)}
                        </select>
                        <button onClick={() => setNewDeckModalOpen(true)} className={`px-3 py-2 text-white rounded ${config.theme.button}`}><PlusCircle size={20}/></button>
                    </div>
                    {tcg === 'mtg' && (
                        <button onClick={() => setAIGenerateModalOpen(true)} className="w-full mb-2 flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-500 transition-colors text-sm">
                            <Wand2 size={16} /> Generate Deck with AI
                        </button>
                    )}
                     {activeDeck && (
                        <div className="flex gap-2">
                             <button onClick={analyzeDeck} className="flex-1 flex items-center justify-center gap-1 px-2 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 text-xs"><BrainCircuit size={14} /> AI Analysis</button>
                             {activeDeck.format === 'commander' &&
                                <button onClick={() => setCommanderModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-500 text-xs"><Crown size={14} /> Set Commander</button>
                            }
                             <button onClick={() => handleDeleteClick(activeDeck.id)} className="p-2 text-red-400 hover:text-red-300"><Trash2 size={18}/></button>
                        </div>
                    )}
                 </div>

                 {activeDeck && (
                    <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700 flex-1 overflow-hidden flex flex-col">
                        <h3 className="font-bold text-indigo-300 mb-2">{activeDeck.name} ({activeDeck?.cards.reduce((acc, c) => acc + c.quantity, 0)} cards)</h3>
                        {activeDeck.commander && (
                             <div className="flex items-center gap-3 mb-3 p-2 bg-yellow-900/50 rounded-lg">
                                 <Crown size={20} className="text-yellow-400"/>
                                 <div>
                                     <p className="text-sm font-bold text-yellow-300">Commander</p>
                                     <p className="text-xs text-gray-300">{activeDeck.commander.name}</p>
                                 </div>
                             </div>
                        )}
                        <div className="overflow-y-auto flex-1 pr-2 space-y-1">
                            {activeDeck.cards.sort((a,b) => a.name.localeCompare(b.name)).map(card => (
                                <div key={card.id} className="flex justify-between items-center bg-gray-700/30 p-2 rounded">
                                    <span className="text-white text-sm cursor-pointer hover:text-indigo-300" onClick={() => setSelectedCard(card)}>{card.quantity}x {card.name}</span>
                                    <div className="flex gap-1">
                                         <button onClick={() => updateCardInDeck(card, -1)} className="text-red-400"><MinusCircle size={16}/></button>
                                         <button onClick={() => updateCardInDeck(card, 1)} className="text-green-400"><PlusCircle size={16}/></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-700">
                             <DeckValidation deck={activeDeck} tcg={tcg}/>
                        </div>
                    </div>
                 )}
            </div>

            <div className="lg:col-span-2 bg-gray-800/50 p-4 rounded-xl border border-gray-700 h-full flex flex-col">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                    <input type="text" name="name" placeholder="Search..." onChange={handleFilterChange} className="p-2 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
                    <input type="text" name="type" placeholder="Type..." onChange={handleFilterChange} className="p-2 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
                    {tcg === 'mtg' && (
                        <>
                            <select name="color" onChange={handleFilterChange} className="p-2 bg-gray-700 border border-gray-600 rounded text-white text-sm">
                                <option value="">All Colors</option>
                                <option value="W">White</option><option value="U">Blue</option><option value="B">Black</option><option value="R">Red</option><option value="G">Green</option>
                            </select>
                            <input type="text" name="keyword" placeholder="Keyword (e.g. Flying)..." onChange={handleFilterChange} className="p-2 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
                        </>
                    )}
                    <div className="flex gap-1">
                        <select value={sort.field} onChange={e => setSort(s => ({ ...s, field: e.target.value }))} className="flex-1 p-2 bg-gray-700 border border-gray-600 rounded text-white text-sm">
                            <option value="name">Name</option>
                            <option value="cmc">Cost</option>
                        </select>
                         <button onClick={() => setSort(s => ({ ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }))} className="p-2 bg-gray-700 rounded hover:bg-gray-600"><ChevronsUpDown size={16} /></button>
                    </div>
                </div>

                {activeDeck ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto pr-2">
                        {filteredCollection.map(card => (
                            <CardDisplayWithControls 
                                key={card.id} 
                                card={card} 
                                onCardClick={setSelectedCard} 
                                deckControls={{
                                    add: () => updateCardInDeck(card, 1),
                                    remove: () => updateCardInDeck(card, -1),
                                    available: card.available,
                                    inDeck: card.inDeck
                                }}
                            />
                        ))}
                    </div>
                ) : <div className="flex items-center justify-center h-full text-gray-500">Select a deck to begin.</div>}
            </div>

            <Modal isOpen={analysis.isOpen} onClose={() => setAnalysis({ ...analysis, isOpen: false })} title={`AI Analysis`}>
                {analysis.isAnalyzing ? <Spinner text="Consulting the oracle..." /> : (
                    <div className="prose prose-invert prose-sm max-w-none text-gray-300 space-y-4">
                         {renderAiText(analysis.result)}
                    </div>
                )}
            </Modal>

            {/* Modal for Recommendations after Generation */}
            <Modal isOpen={!!aiRecommendations} onClose={() => setAiRecommendations(null)} title="AI Recommendations">
                <div className="prose prose-invert prose-sm max-w-none text-gray-300 space-y-4">
                     {renderAiText(aiRecommendations)}
                </div>
            </Modal>
            
            <NewDeckModal isOpen={newDeckModalOpen} onClose={() => setNewDeckModalOpen(false)} onCreate={handleCreateDeck} formats={config.deckFormats} />
            <AIGenerateDeckModal isOpen={aiGenerateModalOpen} onClose={() => setAIGenerateModalOpen(false)} onGenerate={handleAIGenerateDeck} legendaryCreatures={legendaryCreatures} formats={config.deckFormats} />
            
            <Modal isOpen={commanderModalOpen} onClose={() => setCommanderModalOpen(false)} title="Select a Commander">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[60vh] overflow-y-auto">
                    {legendaryCreatures.map(card => (
                        <div key={card.id} className="cursor-pointer" onClick={() => setCommander(card)}>
                           <CardDisplayWithControls card={card} onCardClick={() => setCommander(card)} deckControls={{add: ()=>{}, remove: ()=>{}, available: 1, inDeck: 0}} />
                        </div>
                    ))}
                </div>
            </Modal>
            
            <Modal isOpen={confirmDelete.isOpen} onClose={() => setConfirmDelete({ isOpen: false, deckId: null })} title="Confirm Delete">
                 <div className="flex justify-end gap-2 mt-4">
                    <button onClick={() => setConfirmDelete({ isOpen: false, deckId: null })} className="px-4 py-2 bg-gray-600 rounded text-white">Cancel</button>
                    <button onClick={performDelete} className="px-4 py-2 bg-red-600 rounded text-white">Delete</button>
                 </div>
            </Modal>
            
            {selectedCard && <CardDetailModal tcg={tcg} card={selectedCard} onClose={() => setSelectedCard(null)} />}

        </div>
    );
};

// ... Helper components ...

const NewDeckModal = ({ isOpen, onClose, onCreate, formats }) => {
    const [name, setName] = useState('');
    const [format, setFormat] = useState(formats[0]);
    useEffect(() => setFormat(formats[0]), [formats]);
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Deck">
            <form onSubmit={(e) => { e.preventDefault(); if(name) onCreate(name, format); }}>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full p-2 bg-gray-700 rounded mb-4 text-white" placeholder="Deck Name" required />
                <div className="flex gap-2">
                    {formats.map(f => <button key={f} type="button" onClick={() => setFormat(f)} className={`flex-1 p-2 rounded border ${format === f ? 'border-indigo-500 bg-indigo-900' : 'border-gray-600'}`}>{f}</button>)}
                </div>
                <button type="submit" className="w-full mt-4 p-2 bg-indigo-600 rounded text-white">Create</button>
            </form>
        </Modal>
    );
};

const AIGenerateDeckModal = ({ isOpen, onClose, onGenerate, legendaryCreatures, formats }) => {
    const [format, setFormat] = useState(formats[0]);
    const [commander, setCommander] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        setFormat(formats[0]);
    }, [formats]);

    const handleSubmit = async () => {
        if (format === 'commander' && !commander) {
            alert('Please select a commander.');
            return;
        }
        setIsGenerating(true);
        await onGenerate(format, commander);
        setIsGenerating(false);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Generate Deck with AI">
            <div className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">1. Select Format</label>
                    <div className="flex gap-4">
                         {formats.map(f => (
                            <button key={f} type="button" onClick={() => setFormat(f)} className={`flex-1 p-3 rounded-lg border-2 capitalize ${format === f ? 'border-indigo-500 bg-indigo-900/50' : 'border-gray-600 bg-gray-700'}`}>{f}</button>
                        ))}
                    </div>
                </div>
                
                {format === 'commander' && (
                     <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">2. Select Commander</label>
                        <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto bg-gray-900/50 p-2 rounded-lg">
                            {legendaryCreatures.map(c => (
                                <div key={c.id} onClick={() => setCommander(c)} className={`rounded-lg overflow-hidden cursor-pointer border-2 ${commander?.id === c.id ? 'border-yellow-400' : 'border-transparent'}`}>
                                    <img src={c.image_uris?.art_crop} alt={c.name} className="w-full h-auto"/>
                                </div>
                            ))}
                        </div>
                        {commander && <p className="text-center text-sm mt-2 text-yellow-300">Selected: {commander.name}</p>}
                    </div>
                )}
                
                <div className="flex justify-end pt-4">
                    <button onClick={handleSubmit} disabled={isGenerating} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-500 disabled:bg-gray-500">
                         {isGenerating ? <Spinner text="Building..." /> : <><Wand2 size={20} /> Generate Deck</>}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default DeckBuilder;
