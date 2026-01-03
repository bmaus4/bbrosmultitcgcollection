import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#FFFFFF', '#4299E1', '#1A202C', '#E53E3E', '#38A169', '#718096'];
const PIE_COLORS = {
    White: '#F7FAFC',
    Blue: '#63B3ED',
    Black: '#2D3748',
    Red: '#F56565',
    Green: '#68D391',
    Colorless: '#A0AEC0',
    Multi: '#B794F4',
};

const DeckAnalysis = ({ deck }) => {

    const analysisData = useMemo(() => {
        if (!deck || deck.cards.length === 0) return null;

        const allCards = deck.cards.flatMap(c => Array(c.quantity).fill(c));
        const nonLandCards = allCards.filter(card => !card.type_line.toLowerCase().includes('land'));

        // Mana Curve
        const manaCurve = Array(8).fill(0).map((_, i) => ({ cmc: i, count: 0 }));
        manaCurve.push({ cmc: '8+', count: 0 });

        nonLandCards.forEach(card => {
            const cmc = card.cmc || 0;
            if (cmc >= 8) {
                manaCurve[8].count++;
            } else {
                manaCurve[cmc].count++;
            }
        });

        const avgCmc = nonLandCards.length > 0 
            ? (nonLandCards.reduce((acc, c) => acc + (c.cmc || 0), 0) / nonLandCards.length).toFixed(2)
            : '0.00';

        // Card Types
        const cardTypes = {};
        allCards.forEach(card => {
            const type = card.type_line.split('—')[0].trim();
            cardTypes[type] = (cardTypes[type] || 0) + 1;
        });
        const typeData = Object.entries(cardTypes).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
        
        // Color Distribution
        const colorDistribution = { White: 0, Blue: 0, Black: 0, Red: 0, Green: 0, Colorless: 0, Multi: 0 };
        allCards.forEach(card => {
             if (card.colors && card.colors.length > 1) {
                colorDistribution.Multi++;
            } else if (card.colors && card.colors.length === 1) {
                const colorMap = { 'W': 'White', 'U': 'Blue', 'B': 'Black', 'R': 'Red', 'G': 'Green' };
                colorDistribution[colorMap[card.colors[0]]]++;
            } else {
                colorDistribution.Colorless++;
            }
        });
        const colorData = Object.entries(colorDistribution).filter(([,value]) => value > 0).map(([name, value]) => ({ name, value }));

        // Creature Subtypes (MTG only)
        let creatureSubtypeData = [];
        if (deck.format !== 'unlimited') { // Assuming only MTG has formats other than unlimited
            const creatureSubtypes = {};
            allCards
                .filter(c => c.type_line.includes('Creature'))
                .forEach(c => {
                    const subtypes = c.type_line.split('—')[1];
                    if (subtypes) {
                        subtypes.trim().split(' ').forEach(subtype => {
                            creatureSubtypes[subtype] = (creatureSubtypes[subtype] || 0) + 1;
                        });
                    }
                });
            creatureSubtypeData = Object.entries(creatureSubtypes)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 10); // Show top 10 for clarity
        }

        return { manaCurve, avgCmc, typeData, colorData, creatureSubtypeData };
    }, [deck]);

    if (!analysisData) {
        return <div className="text-center py-8 text-gray-400">No data to analyze.</div>;
    }

    const { manaCurve, avgCmc, typeData, colorData, creatureSubtypeData } = analysisData;

    return (
        <div className="space-y-8">
            <h2 className="text-3xl font-bold text-indigo-300">Analysis for {deck.name}</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-xl font-semibold mb-4">Mana Curve (Avg: {avgCmc})</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={manaCurve} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                            <XAxis dataKey="cmc" stroke="#9CA3AF" />
                            <YAxis allowDecimals={false} stroke="#9CA3AF" />
                            <Tooltip contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568' }} />
                            <Bar dataKey="count" fill="#818CF8" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

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
                
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-xl font-semibold mb-4">Color Distribution</h3>
                     <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie data={colorData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                                {colorData.map((entry) => <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[entry.name]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568' }} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {creatureSubtypeData.length > 0 && (
                     <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                        <h3 className="text-xl font-semibold mb-4">Creature Types (Top 10)</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={creatureSubtypeData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                                <XAxis type="number" stroke="#9CA3AF" />
                                <YAxis type="category" dataKey="name" stroke="#9CA3AF" width={80} />
                                <Tooltip contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568' }} />
                                <Bar dataKey="value" fill="#4FD1C5" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DeckAnalysis;
