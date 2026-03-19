import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MagnifyingGlassIcon, MapPinIcon, BuildingOffice2Icon, ClockIcon } from '@heroicons/react/24/outline';

// Mock data - replace with your actual API data
const jobPostings = [
    { id: 1, title: 'Frontend Developer', company: 'Innovate Inc.', location: 'Remote', type: 'Full-time', description: 'Join our team to build amazing user interfaces.' },
    { id: 2, title: 'Backend Engineer', company: 'Synergy Corp.', location: 'New York, NY', type: 'Full-time', description: 'Work on the core infrastructure of our platform.' },
    { id: 3, title: 'Data Scientist', company: 'QuantumLeap', location: 'San Francisco, CA', type: 'Contract', description: 'Analyze large datasets to extract meaningful insights.' },
    { id: 4, title: 'UX/UI Designer', company: 'Starlight Digital', location: 'Remote', type: 'Part-time', description: 'Design beautiful and intuitive user experiences.' },
    { id: 5, title: 'Product Manager', company: 'Apex Solutions', location: 'Chicago, IL', type: 'Full-time', description: 'Lead the product vision and strategy for our new analytics platform.' },
];

const JobCard = ({ job }) => (
    <div className="bg-white shadow-md rounded-lg p-6 border border-gray-200 hover:shadow-xl transition-shadow duration-300">
        <h3 className="font-bold text-xl text-gray-800">{job.title}</h3>
        <div className="flex items-center text-sm text-gray-600 mt-2">
            <BuildingOffice2Icon className="w-4 h-4 mr-2" />
            <span>{job.company}</span>
        </div>
        <div className="flex items-center text-sm text-gray-600 mt-2">
            <MapPinIcon className="w-4 h-4 mr-2" />
            <span>{job.location}</span>
        </div>
        <div className="flex items-center text-sm text-gray-600 mt-2">
            <ClockIcon className="w-4 h-4 mr-2" />
            <span>{job.type}</span>
        </div>
        <p className="text-gray-700 mt-4 text-sm">{job.description}</p>
        <div className="mt-6">
            <Link to={`/job-postings/details/${job.id}`} className="font-semibold text-blue-600 hover:text-blue-800">
                View Details
            </Link>
        </div>
    </div>
);

const JobPostings = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [locationFilter, setLocationFilter] = useState('');
    const [jobTypeFilter, setJobTypeFilter] = useState('All Types');

    const filteredJobs = useMemo(() => {
        return jobPostings.filter(job => {
            const matchesSearch = job.title.toLowerCase().includes(searchTerm.toLowerCase()) || job.company.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesLocation = job.location.toLowerCase().includes(locationFilter.toLowerCase());
            const matchesJobType = jobTypeFilter === 'All Types' || job.type === jobTypeFilter;
            return matchesSearch && matchesLocation && matchesJobType;
        });
    }, [searchTerm, locationFilter, jobTypeFilter]);

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold text-gray-800">Job Postings</h1>
                    <p className="text-lg text-gray-600 mt-2">Discover your next career move.</p>
                </div>

                {/* Filter Controls */}
                <div className="bg-white p-4 rounded-lg shadow-md mb-8 sticky top-0 z-10">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="relative">
                            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input 
                                type="text"
                                placeholder="Search by title or company..."
                                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <input 
                            type="text"
                            placeholder="Filter by location..."
                            className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={locationFilter}
                            onChange={e => setLocationFilter(e.target.value)}
                        />
                        <select 
                            className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={jobTypeFilter}
                            onChange={e => setJobTypeFilter(e.target.value)} >
                            <option>All Types</option>
                            <option>Full-time</option>
                            <option>Part-time</option>
                            <option>Contract</option>
                        </select>
                    </div>
                </div>

                {/* Job Listings */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {filteredJobs.length > 0 ? (
                        filteredJobs.map(job => <JobCard key={job.id} job={job} />)
                    ) : (
                        <p className="text-gray-500 md:col-span-3 text-center">No job postings match your criteria.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default JobPostings;
