import React from 'react';

const ReadingsAndDosagesTable = ({ stopData, readingTemplates, dosageTemplates }) => {

    const readingTemplateCounter = readingTemplates.reduce((acc, template) => {
        acc[template.id] = stopData.some(data => data.readings.some(r => r.templateId === template.id));
        return acc;
    }, {});

    const dosageTemplateCounter = dosageTemplates.reduce((acc, template) => {
        acc[template.id] = stopData.some(data => data.dosages.some(d => d.templateId === template.id));
        return acc;
    }, {});

    const formatDate = (date) => {
        const d = new Date(date);
        return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear().toString().slice(-2)}`;
    };

    if (stopData.length === 0) {
        return <div className="text-center p-8 border rounded-md bg-gray-50">No Current History</div>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        {readingTemplates.map(template => (
                            readingTemplateCounter[template.id] && (
                                <th key={template.id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{template.name}</th>
                            )
                        ))}
                        {dosageTemplates.map(template => (
                            dosageTemplateCounter[template.id] && (
                                <th key={template.id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{template.name}</th>
                            )
                        ))}
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stop ID</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {stopData.map(data => (
                        <tr key={data.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(data.date)}</td>
                            {readingTemplates.map(template => {
                                if (!readingTemplateCounter[template.id]) return null;
                                const reading = data.readings.find(r => r.universalTemplateId === template.readingsTemplateId);
                                const amount = reading ? parseFloat(reading.amount) : null;
                                const isHigh = template.highWarning && amount > template.highWarning;
                                const isLow = template.lowWarning && amount < template.lowWarning;
                                const textColor = isHigh || isLow ? 'text-red-500' : 'text-green-500';

                                return (
                                    <td key={template.id} className={`px-6 py-4 whitespace-nowrap text-sm ${textColor}`}>
                                        {amount !== null ? amount.toFixed(1) : '-'}
                                    </td>
                                );
                            })}
                            {dosageTemplates.map(template => {
                                if (!dosageTemplateCounter[template.id]) return null;
                                const dosage = data.dosages.find(d => d.universalTemplateId === template.dosageTemplateId);
                                return (
                                    <td key={template.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {dosage ? dosage.amount : '-'}
                                    </td>
                                );
                            })}
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <button
                                    onClick={() => console.log(`Show Detail View For Service Stop ${data.serviceStopId}`)}
                                    className="text-blue-600 hover:text-blue-900"
                                >
                                    {data.serviceStopId}
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default ReadingsAndDosagesTable;
