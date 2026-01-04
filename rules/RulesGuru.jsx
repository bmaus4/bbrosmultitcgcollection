import React, { useState } from 'react';
import { Gavel, PlusCircle, X, HelpCircle, BookOpen } from 'lucide-react';
import { searchCard, askMtgRules } from '../../services/api';
import { Spinner } from '../../components/Shared';

const RulesGuru = ({ showMessage }) => {
    const [question, setQuestion] = useState('');
    const [cardSearch, setCardSearch] = useState('');
    const [contextCards, setContextCards] = useState([]);
    const [isSearchingCard, setIsSearchingCard] = useState(false);
    const [answer, setAnswer] = useState(null);
    const [isAsking, setIsAsking] = useState(false);

    const handleAddCard = async (e) => {
        e.preventDefault();
        if (!cardSearch.trim()) return;
        setIsSearchingCard(true);
        try {
            // Using searchCard from API, forcing MTG context
            const results = await searchCard('mtg', cardSearch);
            // searchCard returns an array for MTG, take the first/best match
            if (results && results.length > 0) {
                const card = results[0];
                if (!contextCards.find(c => c.id === card.id)) {
                    setContextCards(prev => [...prev, card]);
                    showMessage(`Added ${card.name} to context.`, 'success');
                } else {
                    showMessage(`${card.name} is already added.`, 'info');
                }
                setCardSearch('');
            }
        } catch (error) {
            console.error(error);
            showMessage('Could not find card.', 'error');
        } finally {
            setIsSearchingCard(false);
        }
    };

    const handleRemoveCard = (cardId) => {
        setContextCards(prev => prev.filter(c => c.id !== cardId));
    };

    const handleAskJudge = async () => {
        if (!question.trim()) {
            showMessage('Please enter a question.', 'error');
            return;
        }
        setIsAsking(true);
        setAnswer(null);
        try {
            const result = await askMtgRules(question, contextCards);
            setAnswer(result);
        } catch (error) {
            console.error(error);
            showMessage('The Judge is unavailable right now.', 'error');
        } finally {
            setIsAsking(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[85vh]">
            {/* Left Panel: Inputs */}
            <div className="lg:col-span-1 space-y-6 overflow-y-auto pr-2">
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-purple-500/30 backdrop-blur-sm shadow-xl">
                    <div className="flex items-center gap-2 mb-4">
                        <Gavel className="text-purple-400" size={24} />
                        <h2 className="text-xl font-bold text-indigo-100">Ask the Rules Guru</h2>
                    </div>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Your Question</label>
                            <textarea 
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                placeholder="e.g., If I block with a creature that has deathtouch and trample..."
                                className="w-full h-32 p-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:outline-none resize-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Context Cards (Optional)
                                <span className="block text-xs text-gray-500 font-normal">Add specific cards to ensure the AI uses the latest Oracle text.</span>
                            </label>
                            <form onSubmit={handleAddCard} className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={cardSearch}
                                    onChange={(e) => setCardSearch(e.target.value)}
                                    placeholder="Card name..."
                                    className="flex-1 p-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                />
                                <button 
                                    type="submit" 
                                    disabled={isSearchingCard}
                                    className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white disabled:opacity-50 transition-colors"
                                >
                                    {isSearchingCard ? <Spinner text="" /> : <PlusCircle size={20} />}
                                </button>
                            </form>
                        </div>

                        {/* Selected Context Cards */}
                        {contextCards.length > 0 && (
                            <div className="space-y-2">
                                {contextCards.map(card => (
                                    <div key={card.id} className="flex items-center justify-between bg-gray-700/40 p-2 rounded-lg border border-gray-600/50">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <img src={card.image_uris?.art_crop} alt="" className="w-8 h-8 rounded-full object-cover border border-purple-500/50" />
                                            <span className="text-sm text-gray-200 truncate">{card.name}</span>
                                        </div>
                                        <button onClick={() => handleRemoveCard(card.id)} className="text-red-400 hover:text-red-300 p-1">
                                            <X size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button 
                            onClick={handleAskJudge}
                            disabled={isAsking}
                            className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                        >
                            {isAsking ? <Spinner text="Consulting the Comprehensive Rules..." /> : <><HelpCircle size={20} /> Ask Judge</>}
                        </button>
                    </div>
                </div>
            </div>

            {/* Right Panel: Answer */}
            <div className="lg:col-span-2 h-full">
                <div className="bg-gray-800/50 h-full rounded-2xl border border-gray-700 backdrop-blur-sm p-6 overflow-y-auto shadow-inner relative">
                    {!answer && !isAsking && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 opacity-50">
                            <BookOpen size={64} className="mb-4" />
                            <p className="text-lg">Enter a question to verify rules interactions.</p>
                        </div>
                    )}
                    
                    {answer && (
                        <div className="prose prose-invert prose-purple max-w-none">
                            <h3 className="text-2xl font-bold text-purple-300 mb-6 flex items-center gap-2">
                                <Gavel className="text-purple-400" />
                                Judge's Ruling
                            </h3>
                            <div dangerouslySetInnerHTML={{ __html: answer }} className="text-gray-200 leading-relaxed space-y-4" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RulesGuru;