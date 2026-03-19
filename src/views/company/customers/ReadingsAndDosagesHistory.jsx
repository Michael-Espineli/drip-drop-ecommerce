import React, { useState, useEffect, useCallback } from 'react';
import ReadingsAndDosagesTable from './ReadingsAndDosagesTable';

// Mock Data Service - Replace with your actual data fetching logic
const mockDataService = {
    getAllReadingTemplates: async (companyId) => [
        { id: 'rt1', readingsTemplateId: 'urt1', name: 'pH', chemType: 'ph', UOM: '' , highWarning: 7.8, lowWarning: 7.2},
        { id: 'rt2', readingsTemplateId: 'urt2', name: 'Chlorine', chemType: 'chlorine', UOM: 'ppm', highWarning: 5, lowWarning: 1 },
    ],
    getAllDosageTemplates: async (companyId) => [
        { id: 'dt1', dosageTemplateId: 'udt1', name: 'Muriatic Acid', UOM: 'oz', rate: '1' },
        { id: 'dt2', dosageTemplateId: 'udt2', name: 'Trichlor', UOM: 'tabs', rate: '2' },
    ],
    getAllCustomerServiceLocationsId: async (companyId, customerId) => [
        { id: 'sl1', nickName: 'Main Pool', address: { streetAddress: '123 Main St' } },
        { id: 'sl2', nickName: 'Guest House Pool', address: { streetAddress: '456 Guest Ave' } },
    ],
    getAllBodiesOfWaterByServiceLocation: async (companyId, serviceLocation) => {
        if (serviceLocation.id === 'sl1') {
            return [{ id: 'bow1', name: 'Main Pool' }];
        }
        if (serviceLocation.id === 'sl2') {
            return [{ id: 'bow2', name: 'Guest Pool' }];
        }
        return [];
    },
    getRecentServiceStopsByBodyOfWater: async (companyId, bodyOfWaterId, amount) => {
        // Return some mock history
        if (bodyOfWaterId === 'bow1') {
            return [
                {
                    id: 'sd1',
                    date: new Date(),
                    serviceStopId: 'ss1',
                    readings: [{ templateId: 'rt1', universalTemplateId: 'urt1', name: 'pH', amount: '7.5' }, { templateId: 'rt2', universalTemplateId: 'urt2', name: 'Chlorine', amount: '3' }],
                    dosages: [{ templateId: 'dt1', universalTemplateId: 'udt1', name: 'Muriatic Acid', amount: '8' }],
                    bodyOfWaterId: 'bow1'
                }
            ];
        }
        return [];
    },
    uploadStopData: async (companyId, stopData) => {
        console.log('Uploaded stop data:', stopData);
        return stopData;
    }
};


const ReadingsAndDosagesHistory = ({ customerId }) => {
    const [readingTemplates, setReadingTemplates] = useState([]);
    const [dosageTemplates, setDosageTemplates] = useState([]);
    const [locations, setLocations] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState(null);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState(null);
    const [currentHistory, setCurrentHistory] = useState([]);

    const companyId = 'test-company'; // Replace with actual company Id

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const [readings, dosages, locs] = await Promise.all([
                    mockDataService.getAllReadingTemplates(companyId),
                    mockDataService.getAllDosageTemplates(companyId),
                    mockDataService.getAllCustomerServiceLocationsId(companyId, customerId),
                ]);
                setReadingTemplates(readings);
                setDosageTemplates(dosages);
                setLocations(locs);
                if (locs.length > 0) {
                    setSelectedLocation(locs[0]);
                }
            } catch (error) {
                console.error("Error loading initial data:", error);
            }
        };
        loadInitialData();
    }, [customerId, companyId]);

    useEffect(() => {
        const loadBodiesOfWater = async () => {
            if (selectedLocation) {
                try {
                    const bows = await mockDataService.getAllBodiesOfWaterByServiceLocation(companyId, selectedLocation);
                    setBodiesOfWater(bows);
                    if (bows.length > 0) {
                        setSelectedBodyOfWater(bows[0]);
                    }
                } catch (error) {
                    console.error("Error loading bodies of water:", error);
                }
            }
        };
        loadBodiesOfWater();
    }, [selectedLocation, companyId]);

    useEffect(() => {
        const loadHistory = async () => {
            if (selectedBodyOfWater) {
                try {
                    const history = await mockDataService.getRecentServiceStopsByBodyOfWater(companyId, selectedBodyOfWater.id, 20);
                    setCurrentHistory(history);
                } catch (error) {
                    console.error("Error loading history:", error);
                }
            }
        };
        loadHistory();
    }, [selectedBodyOfWater, companyId]);

    const handleLoadTestData = useCallback(async () => {
        if (!selectedLocation || !selectedBodyOfWater) return;

        const stopData = [];
        let count = 0;
        for (let i = 0; i < 10; i++) {
            const readings = readingTemplates.map(template => ({
                id: Math.random().toString(36).substring(2),
                templateId: template.id,
                universalTemplateId: template.readingsTemplateId,
                dosageType: template.chemType,
                name: template.name,
                amount: (Math.random() * 10).toFixed(1),
                UOM: template.UOM,
                bodyOfWaterId: selectedBodyOfWater.id,
            }));

            const dosages = dosageTemplates.map(template => ({
                id: Math.random().toString(36).substring(2),
                templateId: template.id,
                universalTemplateId: template.dosageTemplateId,
                name: template.name,
                amount: (Math.random() * 10).toFixed(1),
                UOM: template.UOM,
                rate: template.rate,
                bodyOfWaterId: selectedBodyOfWater.id,
            }));

            const newDate = new Date();
            newDate.setDate(newDate.getDate() - count);

            stopData.push({
                id: Math.random().toString(36).substring(2),
                date: newDate,
                serviceStopId: `comp_ss_${Math.random().toString(36).substring(2)}`,
                readings,
                dosages,
                observation: ['Clear'],
                bodyOfWaterId: selectedBodyOfWater.id,
                customerId,
                serviceLocationId: selectedLocation.id,
                userId: '',
                equipmentMeasurements: [],
            });
            count += 7;
        }

        try {
            for (const data of stopData) {
                await mockDataService.uploadStopData(companyId, data);
            }
            //- Refresh history after loading test data
            const history = await mockDataService.getRecentServiceStopsByBodyOfWater(companyId, selectedBodyOfWater.id, 20);
            setCurrentHistory(history);

        } catch (error) {
            console.error("Error loading test data:", error);
        }
    }, [selectedLocation, selectedBodyOfWater, readingTemplates, dosageTemplates, customerId, companyId]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
                <select
                    value={selectedLocation?.id || ''}
                    onChange={(e) => setSelectedLocation(locations.find(l => l.id === e.target.value))}
                    className="p-2 border rounded-md"
                >
                    <option value="" disabled>Select Location</option>
                    {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.address.streetAddress}</option>)}
                </select>

                <select
                    value={selectedBodyOfWater?.id || ''}
                    onChange={(e) => setSelectedBodyOfWater(bodiesOfWater.find(b => b.id === e.target.value))}
                    className="p-2 border rounded-md"
                    disabled={!selectedLocation}
                >
                    <option value="" disabled>Select Body of Water</option>
                    {bodiesOfWater.map(bow => <option key={bow.id} value={bow.id}>{bow.name}</option>)}
                </select>
                <button
                    onClick={handleLoadTestData}
                    className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600"
                >
                    Load Test Data
                </button>
            </div>

            <ReadingsAndDosagesTable
                stopData={currentHistory}
                readingTemplates={readingTemplates}
                dosageTemplates={dosageTemplates}
            />
        </div>
    );
};

export default ReadingsAndDosagesHistory;
