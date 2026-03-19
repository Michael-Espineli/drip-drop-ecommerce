import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapPinIcon, BuildingOffice2Icon, ClockIcon, ArrowLeftIcon, BriefcaseIcon } from '@heroicons/react/24/outline';

// Mock data - replace with your actual API data fetching logic
const allJobPostings = [
    { id: 1, title: 'Frontend Developer', company: 'Innovate Inc.', location: 'Remote', type: 'Full-time', description: 'We are looking for an experienced frontend developer to join our team. You will be responsible for building and maintaining our web applications. The ideal candidate has a strong understanding of JavaScript, React, and modern web development practices. You will work closely with our design and backend teams to create a seamless user experience.', qualifications: ['3+ years of experience with React', 'Proficiency in HTML, CSS, and JavaScript (ES6+)', 'Experience with RESTful APIs', 'Strong problem-solving skills'] },
    { id: 2, title: 'Backend Engineer', company: 'Synergy Corp.', location: 'New York, NY', type: 'Full-time', description: 'As a Backend Engineer, you will work on the core services that power our platform. You will be responsible for designing, building, and maintaining our APIs and databases. We are looking for someone with a passion for building scalable and reliable systems.', qualifications: ['5+ years of experience with Node.js or Python', 'Experience with PostgreSQL or similar relational databases', 'Knowledge of microservices architecture', 'Experience with cloud platforms like AWS or Google Cloud'] },
    { id: 3, title: 'Data Scientist', company: 'QuantumLeap', location: 'San Francisco, CA', type: 'Contract', description: 'Join our research team to work on cutting-edge data science problems. You will be responsible for analyzing large datasets, building machine learning models, and presenting your findings to stakeholders. This is a great opportunity for someone who wants to make a big impact.', qualifications: ['PhD or Masters in Computer Science, Statistics, or related field', 'Experience with Python and data science libraries (e.g., Pandas, Scikit-learn, TensorFlow)', 'Strong statistical and mathematical skills', 'Excellent communication skills'] },
    { id: 4, title: 'UX/UI Designer', company: 'Starlight Digital', location: 'Remote', type: 'Part-time', description: 'We are looking for a talented UX/UI designer to help us create beautiful and intuitive user experiences. You will be responsible for the entire design process, from user research and wireframing to creating high-fidelity mockups and prototypes. You will work closely with our product and engineering teams.', qualifications: ['A strong portfolio of design projects', 'Proficiency in design tools like Figma, Sketch, or Adobe XD', 'Experience with user research and usability testing', 'Understanding of HTML/CSS is a plus'] },
    { id: 5, title: 'Product Manager', company: 'Apex Solutions', location: 'Chicago, IL', type: 'Full-time', description: 'As a Product Manager, you will lead the product vision and strategy for our new analytics platform. You will be responsible for defining the product roadmap, gathering requirements, and working with engineering to deliver a successful product. We are looking for a strategic thinker with a passion for building great products.', qualifications: ['5+ years of product management experience', 'Experience with Agile development methodologies', 'Strong analytical and problem-solving skills', 'Excellent communication and leadership skills'] },
];

const JobPostingDetail = () => {
    const { id } = useParams();
    const job = allJobPostings.find(j => j.id === parseInt(id));

    if (!job) {
        return (
            <div className="w-full min-h-screen bg-gray-50 flex items-center justify-center">
                <p className="text-gray-600 text-lg">Job posting not found.</p>
            </div>
        );
    }

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to="/job-postings" className="flex items-center text-gray-600 hover:text-gray-800 font-medium">
                        <ArrowLeftIcon className="w-5 h-5 mr-2" />
                        Back to Job Postings
                    </Link>
                </div>

                <div className="bg-white shadow-lg rounded-xl p-8">
                    {/* Header */}
                    <div className="border-b pb-6 mb-6">
                        <h1 className="text-4xl font-extrabold text-gray-900 mb-2">{job.title}</h1>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-gray-600">
                            <div className="flex items-center gap-2">
                                <BuildingOffice2Icon className="w-5 h-5" />
                                <span className="font-medium">{job.company}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <MapPinIcon className="w-5 h-5" />
                                <span>{job.location}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <ClockIcon className="w-5 h-5" />
                                <span>{job.type}</span>
                            </div>
                        </div>
                    </div>

                    {/* Job Description */}
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-gray-800 mb-4">Job Description</h2>
                        <p className="text-gray-700 leading-relaxed">{job.description}</p>
                    </div>

                    {/* Qualifications */}
                    {job.qualifications && job.qualifications.length > 0 && (
                        <div className="mb-8">
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">Qualifications</h2>
                            <ul className="list-disc list-inside text-gray-700 space-y-2">
                                {job.qualifications.map((q, index) => (
                                    <li key={index}>{q}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    {/* Apply Button */}
                    <div className="mt-8 pt-6 border-t flex justify-center">
                         <button className="w-full sm:w-auto bg-blue-600 text-white font-bold py-3 px-12 rounded-lg hover:bg-blue-700 transition-transform transform hover:scale-105 duration-300 flex items-center justify-center gap-2">
                            <BriefcaseIcon className="w-6 h-6" />
                            <span>Apply Now</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default JobPostingDetail;
