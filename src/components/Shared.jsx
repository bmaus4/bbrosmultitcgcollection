import React, { useState, useEffect, useRef } from 'react';
import { X, PlusCircle, MinusCircle, DollarSign } from 'lucide-react';
import { getKeywordDefinitions } from '../services/api';
import { format } from 'd3-format';

export const Modal = ({ isOpen, onClose, children, title, size = 'max-w-2xl' }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4">
            <div className={`bg-gray-800 rounded-2xl shadow-2xl w-full ${size} max-h-[90vh] flex flex-col border border-indigo-500/30`}>
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-xl font-bold text-indigo-300">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-2 rounded-full bg-gray-700/50 hover:bg-gray-600">
                        <X size={20} />
                    </button>
                </header>
                <div className="p-6 overflow-y-auto">{children}</div>
            </div>
        </div>
    );
};

export const Spinner = ({ text = "Loading..." }) => (
    <div className="flex flex-col items-center justify-center space-y-2">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-400"></div>
        <p className="text-indigo-200">{text}</p>
    </div>
);

// Custom hook for long-press functionality
const useLongPress = (callback, ms = 200) => {
    const [startLongPress, setStartLongPress] = useState(false);
    const intervalRef = useRef();

    useEffect(() => {
        if (startLongPress) {
            intervalRef.current = setInterval(() => {
                callback();
            }, ms);
        } else {
            clearInterval(intervalRef.current);
        }

        return () => {
            clearInterval(intervalRef.current);
        };
    }, [startLongPress, ms, callback]);

    return {
        onMouseDown: () => setStartLongPress(true),
        onMouseUp: () => setStartLongPress(false),
        onMouseLeave: () => setStartLongPress(false),
        onTouchStart: () => setStartLongPress(true),
        onTouchEnd: () => setStartLongPress(false),
    };
};

export const CardDisplay = ({ card, onDelete, onAdd, onCardClick, tcg, deckControls }) => {
    let priceDisplay;
    if (tcg === 'pokemon') {
        if (card.isGraded) {
            const basePrice = card.ungraded_price || 0;
            const multiplier = card.rarity?.includes('Holofoil') ? 5 : 3;
            priceDisplay = format("$,.2f")(basePrice * multiplier * (card.grade / 10));
        } else {
            priceDisplay = format("$,.2f")(card.ungraded_price || 0);
        }
    } else {
        priceDisplay = card.type_line;
    }

    const addPressProps = useLongPress(() => onAdd && onAdd(card));

    return (
    <div className="bg-gray-800/50 rounded-lg overflow-hidden shadow-lg border border-gray-700 hover:border-indigo-500 transition-all duration-300 transform hover:-translate-y-1 group relative backdrop-blur-sm">
        <img
            src={card.image_uris?.normal || `https://placehold.co/600x838/1f2937/7c3aed?text=${encodeURIComponent(card.name)}`}
            alt={card.name}
            className="w-full h-auto transition-transform duration-300 group-hover:scale-105 cursor-pointer"
            onClick={() => onCardClick && onCardClick(card)}
            onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/600x838/1f2937/7c3aed?text=No+Image`; }}
        />
        <div className="absolute top-1 right-1 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
            x{card.quantity || card.available || 0}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-none">
            <h3 className="font-bold text-white truncate text-sm">{card.name}</h3>
            <p className="text-gray-400 text-xs flex items-center gap-1">
                {tcg === 'pokemon' && card.ungraded_price > 0 && <DollarSign size={12}/>}
                {priceDisplay}
            </p>
        </div>
        
        {/* Conditional rendering for Collection vs Deck Builder controls */}
        {deckControls ? (
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                <button onClick={deckControls.remove} disabled={deckControls.inDeck <= 0} className="p-2 bg-red-600 rounded-full text-white disabled:bg-gray-600"><MinusCircle size={20} /></button>
                <span className="text-white font-bold text-lg">{deckControls.inDeck}</span>
                <button onClick={deckControls.add} disabled={deckControls.available <= 0} className="p-2 bg-green-600 rounded-full text-white disabled:bg-gray-600"><PlusCircle size={20} /></button>
            </div>
        ) : (
            <div className="absolute top-1 left-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onDelete && (
                    <button onClick={() => onDelete(card.id)} className="p-2 bg-red-500/80 hover:bg-red-500 rounded-full text-white shadow-md backdrop-blur-sm">
                    <MinusCircle size={18} />
                    </button>
                )}
                {onAdd && (
                    <button {...addPressProps} onClick={() => onAdd(card)} className="p-2 bg-green-500/80 hover:bg-green-500 rounded-full text-white shadow-md backdrop-blur-sm">
                    <PlusCircle size={18} />
                    </button>
                )}
            </div>
        )}
    </div>
)};

export const CardDetailModal = ({ tcg, card, onClose }) => {
    const [keywords, setKeywords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const fetchKeywords = async () => {
            if (tcg === 'mtg' && card.keywords && card.keywords.length > 0) {
                setIsLoading(true);
                try {
                    const definitions = await getKeywordDefinitions(card.keywords);
                    setKeywords(definitions);
                } catch (error) {
                    console.error("Failed to get keyword definitions", error);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        fetchKeywords();
    }, [card, tcg]);

    return (
        <Modal isOpen={true} onClose={onClose} title={card.name} size="max-w-4xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <img src={card.image_uris?.large} alt={card.name} className="w-full rounded-lg" />
                <div className="space-y-4">
                    {tcg === 'mtg' && (
                        <div>
                            <h3 className="text-lg font-bold text-indigo-300 border-b border-gray-700 pb-2">Keyword Abilities</h3>
                            {isLoading ? <Spinner text="Loading definitions..."/> : (
                                <div className="space-y-3 max-h-96 overflow-y-auto pr-2 mt-2">
                                    {keywords.length > 0 ? keywords.map(kw => (
                                        <div key={kw.name}>
                                            <h4 className="font-semibold text-white capitalize">{kw.name}</h4>
                                            <p className="text-gray-400 text-sm">{kw.definition}</p>
                                        </div>
                                    )) : <p className="text-gray-500">This card has no defined keywords.</p>}
                                </div>
                            )}
                        </div>
                    )}
                     {tcg === 'pokemon' && card.prices && (
                        <div>
                            <h3 className="text-lg font-bold text-yellow-300 border-b border-gray-700 pb-2 flex items-center gap-2"><DollarSign size={20}/> Price Estimates</h3>
                            <div className="space-y-3 mt-2">
                                {Object.entries(card.prices).map(([rarity, priceData]) => (
                                    <div key={rarity} className="p-2 bg-gray-700/50 rounded-lg">
                                        <h4 className="font-semibold text-white capitalize">{rarity}</h4>
                                        <div className="flex justify-between text-sm text-gray-300">
                                            <span>Market (Ungraded):</span>
                                            <span className="font-mono">{format("$,.2f")(priceData.market)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm text-gray-400">
                                            <span>Est. Graded (PSA 10):</span>
                                            <span className="font-mono">{format("$,.2f")(priceData.graded_10_est)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {tcg === 'yugioh' && (
                         <div>
                            <h3 className="text-lg font-bold text-red-400 border-b border-gray-700 pb-2">Card Details</h3>
                            <div className="space-y-2 mt-2 text-gray-300">
                                <p><strong>Type:</strong> {card.race}</p>
                                {card.atk !== undefined && <p><strong>ATK:</strong> {card.atk}</p>}
                                {card.def !== undefined && <p><strong>DEF:</strong> {card.def}</p>}
                                <p className="text-sm pt-2 border-t border-gray-700/50">{card.oracle_text}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

// NEW: A component to show card image on hover
export const CardHoverLink = ({ name }) => {
    const [showPreview, setShowPreview] = useState(false);
    const [imageUrl, setImageUrl] = useState(null);

    // Fetch image on hover to save bandwidth
    const handleMouseEnter = async () => {
        setShowPreview(true);
        if (!imageUrl) {
            try {
                const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
                const data = await response.json();
                setImageUrl(data.image_uris?.normal);
            } catch (e) {
                console.error("Failed to preview card", e);
            }
        }
    };

    return (
        <span 
            className="relative inline-block text-indigo-400 font-semibold cursor-help underline decoration-dotted"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setShowPreview(false)}
        >
            {name}
            {showPreview && imageUrl && (
                <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg shadow-xl bg-black border border-indigo-500 overflow-hidden pointer-events-none">
                    <img src={imageUrl} alt={name} className="w-full h-auto" />
                </div>
            )}
        </span>
    );
};
