import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronsUpDown, Search, MinusCircle, DollarSign, PlusCircle, ScanLine } from 'lucide-react';
import { Modal, CardDetailModal, Spinner } from '../../components/Shared';
import { searchCard } from '../../services/api';
import { format } from 'd3-format';
import CardScanner from '../scanner/CardScanner';

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


const CardDisplay = ({ card, onDelete, onAdd, onCardClick, tcg }) => {
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
            x{card.quantity}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 right-0 p-3 flex justify-between items-end pointer-events-none">
            <div>
                <h3 className="font-bold text-white truncate text-sm">{card.name}</h3>
                <p className="text-gray-400 text-xs flex items-center gap-1">
                    {tcg === 'pokemon' && card.ungraded_price > 0 && <DollarSign size={12}/>}
                    {priceDisplay}
                </p>
            </div>
            {tcg === 'pokemon' && (card.isGraded || card.condition) && (
                <div className="text-right">
                    <p className="text-xs font-semibold text-yellow-300">{card.isGraded ? `PSA ${card.grade}` : card.condition}</p>
                </div>
            )}
        </div>

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
    </div>
)};

const VersionSelectModal = ({ searchResults, onSelectCard, onClose, tcg }) => (
    <Modal isOpen={true} onClose={onClose} title={`Select a Version of ${searchResults[0].name}`} size="max-w-4xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-h-[70vh] overflow-y-auto">
            {searchResults.map(card => (
                <div key={card.id} className="cursor-pointer group" onClick={() => onSelectCard(card)}>
                    <img src={tcg === 'pokemon' ? card.images.small : card.image_uris.normal} alt={card.name} className="w-full rounded-lg transition-transform duration-300 group-hover:scale-105"/>
                    <p className="text-center text-sm mt-1 text-gray-300">{card.set.name} #{card.number}</p>
                    <p className="text-center text-xs text-gray-400">{card.rarity}</p>
                </div>
            ))}
        </div>
    </Modal>
);

const PokemonConditionModal = ({ card, onAdd, onClose }) => {
    const [isGraded, setIsGraded] = useState(false);
    const [grade, setGrade] = useState(10);
    const [condition, setCondition] = useState('Near Mint');

    const handleAdd = () => {
        const cardData = {
            ...card,
            isGraded,
            grade: isGraded ? grade : null,
            condition: !isGraded ? condition : null,
        };
        onAdd(cardData);
    };

    return (
        <Modal isOpen={true} onClose={onClose} title={`Add ${card.name} - ${card.set.name}`}>
            <div className="space-y-6">
                <div className="flex gap-4">
                    <button onClick={() => setIsGraded(false)} className={`flex-1 p-3 rounded-lg border-2 ${!isGraded ? 'border-indigo-500 bg-indigo-900/50' : 'border-gray-600'}`}>Ungraded</button>
                    <button onClick={() => setIsGraded(true)} className={`flex-1 p-3 rounded-lg border-2 ${isGraded ? 'border-indigo-500 bg-indigo-900/50' : 'border-gray-600'}`}>Graded</button>
                </div>

                {isGraded ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Grade (1-10)</label>
                        <input type="number" min="1" max="10" step="0.5" value={grade} onChange={e => setGrade(e.target.value)} className="w-full p-2 bg-gray-700 rounded-lg"/>
                    </div>
                ) : (
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Condition</label>
                        <select value={condition} onChange={e => setCondition(e.target.value)} className="w-full p-2 bg-gray-700 rounded-lg">
                            <option>Near Mint</option>
                            <option>Lightly Played</option>
                            <option>Moderately Played</option>
                            <option>Heavily Played</option>
                            <option>Damaged</option>
                            <option>Foil</option>
                            <option>Reverse Holo</option>
                        </select>
                    </div>
                )}
                <div className="flex justify-end">
                    <button onClick={handleAdd} className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg">Add to Collection</button>
                </div>
            </div>
        </Modal>
    );
};

const CollectionManager = ({ tcg, config, collection, onDeleteCard, onAddCard, showMessage }) => {
    const [filters, setFilters] = useState({});
    const [sort, setSort] = useState({ field: 'dateAdded', direction: 'desc' });
    const [manualCardName, setManualCardName] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [selectedCard, setSelectedCard] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [pokemonCardToCondition, setPokemonCardToCondition] = useState(null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    const handleFilterChange = (e) => setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
    
    const handleSearch = async (name) => {
        if (!name.trim()) return;
        setIsSearching(true);
        try {
            const results = await searchCard(tcg, name);
            if (Array.isArray(results)) {
                setSearchResults(results);
            } else {
                onAddCard(results);
            }
        } catch (error) {
            showMessage(error.message, 'error');
        }
        setIsSearching(false);
        setManualCardName('');
    };
    
    const handleVersionSelect = (card) => {
        setSearchResults([]);
        if (tcg === 'pokemon') {
            setPokemonCardToCondition(card);
        } else {
            onAddCard(card);
        }
    };

    const filteredAndSortedCollection = useMemo(() => {
        let items = [...collection];
        Object.entries(filters).forEach(([key, value]) => {
            if (!value) return;
            const lowerCaseValue = value.toLowerCase();
            if (key === 'name') items = items.filter(c => c.name.toLowerCase().includes(lowerCaseValue));
            if (key === 'type') {
                if (tcg === 'pokemon') items = items.filter(c => c.types?.includes(value));
                if (tcg === 'mtg') items = items.filter(c => c.type_line?.toLowerCase().includes(lowerCaseValue));
            }
            if (key === 'keyword' && tcg === 'mtg') {
                items = items.filter(c => c.keywords.some(k => k.toLowerCase().includes(lowerCaseValue)));
            }
            if (key === 'set' && tcg === 'pokemon') items = items.filter(c => c.set.id === value);
            if (key === 'evolvesFrom' && tcg === 'pokemon') items = items.filter(c => c.evolvesFrom?.toLowerCase().includes(lowerCaseValue));
        });

        items.sort((a, b) => {
            if (sort.field === 'name') return a.name.localeCompare(b.name);
            if (sort.field === 'price' && tcg === 'pokemon') return (b.ungraded_price || 0) - (a.ungraded_price || 0);
            return new Date(b.dateAdded) - new Date(a.dateAdded);
        });

        if (sort.direction === 'asc') items.reverse();
        return items;
    }, [collection, filters, sort, tcg]);

    const filterOptions = useMemo(() => {
        if (tcg !== 'pokemon') return {};
        const sets = [...new Map(collection.map(c => [c.set.id, c.set])).values()].sort((a,b) => a.name.localeCompare(b.name));
        const types = [...new Set(collection.flatMap(c => c.types || []))].sort();
        return { sets, types };
    }, [collection, tcg]);

    return (
        <div className="space-y-6">
            <div className="bg-gray-800/50 p-4 rounded-2xl border border-gray-700">
                <form onSubmit={(e) => { e.preventDefault(); handleSearch(manualCardName); }}>
                    <label htmlFor="manual-card-add" className="block text-lg font-medium text-indigo-300 mb-2">Add a New Card</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input 
                            id="manual-card-add"
                            type="text"
                            value={manualCardName}
                            onChange={(e) => setManualCardName(e.target.value)}
                            placeholder={config.placeholder}
                            className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        {tcg === 'mtg' && (
                            <button type="button" onClick={() => setIsScannerOpen(true)} className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-500 transition-colors">
                                <ScanLine size={20} /> Scan
                            </button>
                        )}
                        <button type="submit" disabled={isSearching} className={`flex items-center justify-center gap-2 px-6 py-3 text-white font-bold rounded-lg transition-all disabled:bg-gray-500 disabled:cursor-not-allowed ${config.theme.button}`}>
                            {isSearching ? <Spinner text='' /> : <><Search size={20} /> Add</>}
                        </button>
                    </div>
                </form>
            </div>

            <div className="bg-gray-800/50 p-4 rounded-2xl border border-gray-700 backdrop-blur-sm">
                <div className={`grid grid-cols-1 md:grid-cols-3 ${tcg === 'pokemon' || tcg === 'mtg' ? 'lg:grid-cols-4' : ''} gap-4`}>
                    <input type="text" name="name" placeholder="Filter by name..." onChange={handleFilterChange} className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white" />
                    
                    {tcg === 'pokemon' && <>
                        <select name="type" onChange={handleFilterChange} className="p-3 bg-gray-700 border border-gray-600 rounded-lg text-white"><option value="">All Types</option>{filterOptions.types.map(t => <option key={t}>{t}</option>)}</select>
                        <select name="set" onChange={handleFilterChange} className="p-3 bg-gray-700 border border-gray-600 rounded-lg text-white"><option value="">All Sets</option>{filterOptions.sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                        <input type="text" name="evolvesFrom" placeholder="Evolves from..." onChange={handleFilterChange} className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white" />
                    </>}

                    {tcg === 'mtg' && <>
                         <input type="text" name="type" placeholder="Filter by type (e.g. creature)" onChange={handleFilterChange} className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white" />
                         <input type="text" name="keyword" placeholder="Filter by keyword (e.g. flying)" onChange={handleFilterChange} className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white" />
                    </>}

                    <div className="flex gap-2">
                        <select value={sort.field} onChange={e => setSort(s => ({ ...s, field: e.target.value }))} className="flex-grow p-3 bg-gray-700 border border-gray-600 rounded-lg text-white">
                            <option value="dateAdded">Date Added</option>
                            <option value="name">Name</option>
                            {tcg === 'pokemon' && <option value="price">Price</option>}
                        </select>
                        <button onClick={() => setSort(s => ({ ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }))} className="p-3 bg-gray-700 border border-gray-600 rounded-lg text-white hover:bg-gray-600"><ChevronsUpDown size={20} /></button>
                    </div>
                </div>
            </div>

            {filteredAndSortedCollection.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {filteredAndSortedCollection.map(card => (
                        <CardDisplay key={card.id} tcg={tcg} card={card} onDelete={onDeleteCard} onAdd={onAddCard} onCardClick={setSelectedCard} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-20 bg-gray-800/30 rounded-2xl">
                    <p className="text-gray-400">Your collection is empty.</p>
                </div>
            )}

            {searchResults.length > 0 && <VersionSelectModal searchResults={searchResults} onClose={() => setSearchResults([])} onSelectCard={handleVersionSelect} tcg={tcg} />}
            {pokemonCardToCondition && <PokemonConditionModal card={pokemonCardToCondition} onClose={() => setPokemonCardToCondition(null)} onAdd={(card) => { onAddCard(card); setPokemonCardToCondition(null); }} />}
            {selectedCard && <CardDetailModal tcg={tcg} card={selectedCard} onClose={() => setSelectedCard(null)} />}
            
            <Modal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} title="MTG Card Scanner">
                <CardScanner 
                    showMessage={showMessage}
                    onCardScanned={async (cardName) => {
                        setIsScannerOpen(false); // Close modal first
                        await handleSearch(cardName); // Then search/add
                    }}
                />
            </Modal>
        </div>
    );
};

export default CollectionManager;
