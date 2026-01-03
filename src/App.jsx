import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { BookOpen, Star, Sparkles, Save, AlertTriangle, BarChart2, Gavel } from 'lucide-react'; // Added Gavel icon

import { searchCard } from './services/api';
import { Spinner } from './components/Shared';
import CollectionManager from './features/collection/CollectionManager';
import DeckBuilder from './features/decks/DeckBuilder';
import DeckAnalysis from './features/analysis/DeckAnalysis';
import RulesGuru from './features/rules/RulesGuru'; // Import new component
import Auth from './auth/Auth';

const TCG_CONFIG = {
    mtg: { 
        name: 'Magic: The Gathering', 
        theme: {
            gradient: 'from-purple-900 via-gray-900 to-black',
            font: 'font-serif',
            button: 'bg-purple-600 hover:bg-purple-500',
            tab: 'border-purple-500',
        },
        deckFormats: ['standard', 'commander'],
        placeholder: 'e.g., Sol Ring, Lightning Bolt...',
        hasDecks: true,
        hasRules: true, // Enable rules for MTG
    },
    pokemon: { 
        name: 'Pokémon', 
        theme: {
            gradient: 'from-yellow-700 via-blue-900 to-black',
            font: 'font-sans',
            button: 'bg-yellow-500 hover:bg-yellow-400',
            tab: 'border-yellow-400',
        },
        deckFormats: ['unlimited'],
        placeholder: 'e.g., Charizard, Pikachu...',
        hasDecks: false,
        hasRules: false,
    },
    yugioh: { 
        name: 'Yu-Gi-Oh!', 
        theme: {
            gradient: 'from-red-800 via-black to-blue-900',
            font: 'font-mono',
            button: 'bg-red-600 hover:bg-red-500',
            tab: 'border-red-500',
        },
        deckFormats: ['unlimited'],
        placeholder: 'e.g., Blue-Eyes White Dragon...',
        hasDecks: true,
        hasRules: false,
    },
};

const Toast = ({ message, type, onDismiss }) => {
    useEffect(() => {
        const timer = setTimeout(onDismiss, 5000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    const colors = {
        success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500'
    };

    return (
        <div className={`fixed bottom-5 right-5 p-4 rounded-lg shadow-lg text-white flex items-center gap-3 z-50 ${colors[type] || 'bg-gray-700'}`}>
            {type === 'error' && <AlertTriangle size={20} />}
            <span>{message}</span>
            <button onClick={onDismiss} className="ml-4 text-white/80 hover:text-white">&times;</button>
        </div>
    );
};

function App() {
    const [view, setView] = useState('collection');
    const [activeTCG, setActiveTCG] = useState('mtg');
    const [data, setData] = useState({ mtg: { collection: [], decks: [] }, pokemon: { collection: [], decks: [] }, yugioh: { collection: [], decks: [] } });
    const [activeDeckId, setActiveDeckId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [message, setMessage] = useState({ text: '', type: '', id: 0 });
    
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [user, setUser] = useState(null);

    const showMessage = useCallback((text, type = 'success') => {
        setMessage({ text, type, id: Date.now() });
    }, []);
    
    useEffect(() => {
        if (!TCG_CONFIG[activeTCG].hasDecks && (view === 'decks' || view === 'analysis')) {
            setView('collection');
        }
        if (!TCG_CONFIG[activeTCG].hasRules && view === 'rules') {
            setView('collection');
        }
    }, [activeTCG, view]);


    useEffect(() => {
        try {
            const firebaseConfig = JSON.parse(window.__firebase_config || '{}');
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            setAuth(authInstance);
            setDb(getFirestore(app));

            const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                setUser(user);
                if (!user) {
                    setIsLoading(false);
                }
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Failed to initialize Firebase:", error);
            showMessage('Could not connect to Firebase.', 'error');
            setIsLoading(false);
        }
    }, [showMessage]);

    const appId = window.__app_id || 'multi-tcg-manager';
    
    useEffect(() => {
        const loadData = async () => {
            if (!user || !db) return;
            setIsLoading(true);
            try {
                const docRef = doc(db, "artifacts", appId, "users", user.uid);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const cloudData = docSnap.data();
                    const sanitizedData = {
                        mtg: cloudData.mtg || { collection: [], decks: [] },
                        pokemon: cloudData.pokemon || { collection: [], decks: [] },
                        yugioh: cloudData.yugioh || { collection: [], decks: [] },
                    };
                    setData(sanitizedData);
                }
            } catch (error) {
                console.error("Error loading data:", error);
                showMessage('Could not load your data from the cloud.', 'error');
            }
            setIsLoading(false);
        };
        loadData();
    }, [user, db, appId, showMessage]);

    const saveData = useCallback(async () => {
        if (!user || !db) {
            showMessage('Cannot save: Not authenticated.', 'error');
            return;
        }
        showMessage('Saving...', 'info');
        try {
            const docRef = doc(db, "artifacts", appId, "users", user.uid);
            await setDoc(docRef, data);
            showMessage('Your data has been saved to the cloud!', 'success');
        } catch (error) {
            console.error("Error saving data:", error);
            showMessage('Failed to save data to the cloud.', 'error');
        }
    }, [data, user, db, appId, showMessage]);

    const addCardToCollection = useCallback((cardData) => {
        setData(prev => {
            const tcgData = prev[activeTCG];
            const existingCardIndex = tcgData.collection.findIndex(c => c.id === cardData.id);
            let newCollection;
            if (existingCardIndex > -1) {
                newCollection = [...tcgData.collection];
                newCollection[existingCardIndex].quantity += 1;
            } else {
                newCollection = [{ ...cardData, quantity: 1, dateAdded: new Date().toISOString() }, ...tcgData.collection];
            }
            return { ...prev, [activeTCG]: { ...tcgData, collection: newCollection } };
        });
        showMessage(`Added "${cardData.name} (${cardData.set.name}) " to your collection!`);
    }, [activeTCG, showMessage]);

    const removeCardFromCollection = useCallback((cardId) => {
        setData(prev => {
            const tcgData = prev[activeTCG];
            const cardIndex = tcgData.collection.findIndex(c => c.id === cardId);
            if (cardIndex === -1) return prev;

            const newCollection = [...tcgData.collection];
            if (newCollection[cardIndex].quantity > 1) {
                newCollection[cardIndex].quantity -= 1;
            } else {
                newCollection.splice(cardIndex, 1);
            }
            return { ...prev, [activeTCG]: { ...tcgData, collection: newCollection } };
        });
    }, [activeTCG]);
    
    const currentTCGData = data[activeTCG] || { collection: [], decks: [] };
    const activeDeck = useMemo(() => {
        if (currentTCGData && Array.isArray(currentTCGData.decks)) {
            return currentTCGData.decks.find(d => d.id === activeDeckId);
        }
        return null;
    }, [currentTCGData, activeDeckId]);

    const activeTheme = TCG_CONFIG[activeTCG].theme;

    const renderView = () => {
        switch (view) {
            case 'decks':
                return TCG_CONFIG[activeTCG].hasDecks ? <DeckBuilder 
                            tcg={activeTCG}
                            config={TCG_CONFIG[activeTCG]}
                            collection={currentTCGData.collection} 
                            decks={currentTCGData.decks} 
                            setDecks={(newDecks) => setData(p => ({...p, [activeTCG]: {...p[activeTCG], decks: newDecks}}))}
                            activeDeckId={activeDeckId} 
                            setActiveDeckId={setActiveDeckId} 
                            showMessage={showMessage} 
                        /> : null;
            case 'analysis':
                return TCG_CONFIG[activeTCG].hasDecks && activeDeck ? <DeckAnalysis deck={activeDeck} /> : <div className="text-center py-20 bg-gray-800/30 rounded-2xl"><p className="text-gray-400">Please select a deck to see its analysis.</p></div>;
            case 'rules':
                return <RulesGuru showMessage={showMessage} />;
            default:
                return <CollectionManager 
                            tcg={activeTCG}
                            config={TCG_CONFIG[activeTCG]}
                            collection={currentTCGData.collection} 
                            onDeleteCard={removeCardFromCollection}
                            onAddCard={addCardToCollection}
                            showMessage={showMessage}
                        />;
        }
    };

    if (isLoading) {
        return <div className="bg-gray-900 min-h-screen flex items-center justify-center"><Spinner text="Loading..." /></div>;
    }
    
    if (!user) {
        return <Auth auth={auth} />;
    }

    return (
        <div className={`min-h-screen text-white transition-all duration-500 bg-gradient-to-br ${activeTheme.gradient} ${activeTheme.font}`}>
            <div className="container mx-auto px-4 py-8">
                <header className="mb-8 space-y-6">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-3">
                            <Sparkles className="text-indigo-400" size={32} />
                            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">Multi-TCG Collection</h1>
                        </div>
                        <div className="flex items-center gap-4">
                            <button onClick={saveData} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors"><Save size={18} /> Save</button>
                            <Auth auth={auth} user={user} />
                        </div>
                    </div>
                    <div className="flex justify-center gap-2 p-2 bg-gray-800/60 rounded-full border border-gray-700 backdrop-blur-sm">
                        {Object.keys(TCG_CONFIG).map(tcgKey => (
                            <button key={tcgKey} onClick={() => setActiveTCG(tcgKey)} className={`flex-1 px-4 py-2 rounded-full text-sm font-semibold transition-colors border-2 ${activeTCG === tcgKey ? `${TCG_CONFIG[tcgKey].theme.tab} bg-gray-900 text-white` : 'text-gray-300 hover:bg-gray-700 border-transparent'}`}>
                                {TCG_CONFIG[tcgKey].name}
                            </button>
                        ))}
                    </div>
                     <nav className="flex items-center justify-center gap-2 p-2 bg-gray-800/60 rounded-full border border-gray-700 backdrop-blur-sm">
                        <button onClick={() => setView('collection')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${view === 'collection' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}><Star className="inline-block mr-2" size={16} />Collection</button>
                        {TCG_CONFIG[activeTCG].hasDecks && (
                            <>
                                <button onClick={() => setView('decks')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${view === 'decks' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}><BookOpen className="inline-block mr-2" size={16} />Decks</button>
                                <button onClick={() => setView('analysis')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${view === 'analysis' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}><BarChart2 className="inline-block mr-2" size={16} />Analysis</button>
                            </>
                        )}
                        {TCG_CONFIG[activeTCG].hasRules && (
                            <button onClick={() => setView('rules')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${view === 'rules' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}><Gavel className="inline-block mr-2" size={16} />Rules Guru</button>
                        )}
                    </nav>
                </header>
                <main>{renderView()}</main>
                {message.text && <Toast key={message.id} message={message.text} type={message.type} onDismiss={() => setMessage({ text: '', type: '', id: 0 })} />}
            </div>
        </div>
    );
}

export default App;
