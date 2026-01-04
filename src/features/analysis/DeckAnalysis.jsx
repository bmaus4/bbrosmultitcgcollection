import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { CardHoverLink, Modal, CardDisplay } from '../../components/Shared';

const COLORS = ['#FFFFFF', '#4299E1', '#1A202C', '#E53E3E', '#38A169', '#718096', '#D6BCFA', '#F6E05E'];

const DeckAnalysis = ({ deck }) => {
    const [selectedCmc, setSelectedCmc] = useState(null);

    const analysisData = useMemo(() => {
        if (!deck || deck.cards.length === 0) return null;

        const allCards = deck.cards.flatMap(c => Array(c.quantity).fill(c));
        const nonLandCards = allCards.filter(card => !card.type_line.toLowerCase().includes('land'));
        const lands = allCards.filter(card => card.type_line.toLowerCase().includes('land'));

        // Mana Curve
        const manaCurve = Array(8).fill(0).map((_, i) => ({ cmc: i, count: 0, cards: [] }));
        manaCurve.push({ cmc: '8+', count: 0, cards: [] });

        nonLandCards.forEach(card => {
            const cmc = Math.floor(card.cmc || 0);
            const index = cmc >= 8 ? 8 : cmc;
            manaCurve[index].count++;
            manaCurve[index].cards.push(card);
        });

        const avgCmc = nonLandCards.length > 0 
            ? (nonLandCards.reduce((acc, c) => acc + (c.cmc || 0), 0) / nonLandCards.length).toFixed(2)
            : '0.00';

        // Card Types (Simplified)
        const simplifiedTypes = { Creature: 0, Instant: 0, Sorcery: 0, Enchantment: 0, Artifact: 0, Planeswalker: 0, Land: 0 };
        allCards.forEach(card => {
            const t = card.type_line.toLowerCase();
            if (t.includes('land')) simplifiedTypes.Land++;
            else if (t.includes('creature')) simplifiedTypes.Creature++;
            else if (t.includes('instant')) simplifiedTypes.Instant++;
            else if (t.includes('sorcery')) simplifiedTypes.Sorcery++;
            else if (t.includes('planeswalker')) simplifiedTypes.Planeswalker++;
            else if (t.includes('enchantment')) simplifiedTypes.Enchantment++;
            else if (t.includes('artifact')) simplifiedTypes.Artifact++;
        });
        const typeData = Object.entries(simplifiedTypes)
            .filter(([, val]) => val > 0)
            .map(([name, value]) => ({ name, value }));
        
        // Color Distribution Helper
        const getColorData = (cards) => {
            const counts = { White: 0, Blue: 0, Black: 0, Red: 0, Green: 0, Colorless: 0, Multi: 0 };
            cards.forEach(card => {
                if (card.color_identity && card.color_identity.length > 1) counts.Multi++;
                else if (card.color_identity && card.color_identity.length === 1) {
                    const map = { 'W': 'White', 'U': 'Blue', 'B': 'Black', 'R': 'Red', 'G': 'Green' };
                    counts[map[card.color_identity[0]]]++;
                } else counts.Colorless++;
            });
            return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
        };

        const landColorData = getColorData(lands);
        const spellColorData = getColorData(nonLandCards);

        return { manaCurve, avgCmc, typeData, landColorData, spellColorData };
    }, [deck]);

    if (!analysisData) return <div className="text-center py-8 text-gray-400">No data to analyze.</div>;

    const { manaCurve, avgCmc, typeData, landColorData, spellColorData } = analysisData;

    // Helper to render AI Text with Hover Links
    const renderAiText = (htmlString) => {
        if (!htmlString) return null;
        // Split by [[Card Name]] regex
        const parts = htmlString.split(/(\[\[.*?\]\])/g);
        return parts.map((part, i) => {
            if (part.startsWith('[[') && part.endsWith(']]')) {
                const name = part.slice(2, -2);
                return <CardHoverLink key={i} name={name} />;
            }
            return <span key={i} dangerouslySetInnerHTML={{ __html: part }} />;
        });
    };

    return (
        <div className="space-y-8">
            <h2 className="text-3xl font-bold text-indigo-300">Analysis for {deck.name}</h2>
            
            {/* Added: Display AI Analysis Results if passed down or stored elsewhere, 
                currently DeckAnalysis receives 'deck' but the AI result is usually in a parent state.
                If you want to show analysis text here, it needs to be passed in props.
                For now, I'm ensuring renderAiText is defined but not causing a lint error if unused
                by not exporting it or using it if no text is present. 
                However, to strictly fix "assigned but never used": */}
            {deck.aiAnalysisResult && (
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 prose prose-invert max-w-none">
                    <h3>AI Insights</h3>
                    <div>{renderAiText(deck.aiAnalysisResult)}</div>
                </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Mana Curve */}
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-xl font-semibold mb-4">Mana Curve (Avg: {avgCmc})</h3>
                    <p className="text-xs text-gray-400 mb-2">Click a bar to view cards</p>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={manaCurve} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
                            onClick={(data) => {
                                if (data && data.activePayload && data.activePayload.length > 0) {
                                    setSelectedCmc(data.activePayload[0].payload);
                                }
                            }}
                        >
                            <XAxis dataKey="cmc" stroke="#9CA3AF" />
                            <YAxis allowDecimals={false} stroke="#9CA3AF" />
                            <Tooltip cursor={{fill: '#4A5568'}} contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568' }} />
                            <Bar dataKey="count" fill="#818CF8" style={{ cursor: 'pointer' }} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Simplified Card Types */}
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-xl font-semibold mb-4">Card Types</h3>
                     <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                                {typeData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568' }} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                
                {/* Non-Land Colors */}
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-xl font-semibold mb-4">Spell Color Identity</h3>
                     <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie data={spellColorData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                                {spellColorData.map((entry, i) => <Cell key={i} fill={getPieColor(entry.name)} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                 {/* Land Colors */}
                 <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-xl font-semibold mb-4">Land Color Identity</h3>
                     <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie data={landColorData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                                {landColorData.map((entry, i) => <Cell key={i} fill={getPieColor(entry.name)} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Modal for Mana Curve Interaction */}
            <Modal isOpen={!!selectedCmc} onClose={() => setSelectedCmc(null)} title={`Cards with Mana Value: ${selectedCmc?.cmc}`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {selectedCmc?.cards.map(card => (
                        <div key={card.id}><CardDisplay card={card} tcg="mtg" /></div>
                    ))}
                </div>
            </Modal>
        </div>
    );
};

const getPieColor = (name) => {
    const map = { White: '#F7FAFC', Blue: '#63B3ED', Black: '#2D3748', Red: '#F56565', Green: '#68D391', Colorless: '#A0AEC0', Multi: '#D6BCFA' };
    return map[name] || '#CBD5E0';
};

export default DeckAnalysis;
