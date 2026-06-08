import React, { useContext, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BugAntIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import { useSearchParams } from 'react-router-dom';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { Context } from '../../context/AuthContext';
import {
  createProductFeedbackSubmission,
  FEEDBACK_AUDIENCES,
  FEEDBACK_TYPES,
} from '../../utils/adminInbox';

const emptyForm = {
  type: 'feature',
  audience: FEEDBACK_AUDIENCES.company,
  requesterName: '',
  requesterEmail: '',
  title: '',
  priority: 'Medium',
  description: '',
};

export default function Feedback() {
  const context = useContext(Context);
  const [searchParams] = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  useEffect(() => {
    const requestedType = searchParams.get('type');
    const accountAudience = context.accountType === 'Client'
      ? FEEDBACK_AUDIENCES.client
      : context.accountType === 'Company'
        ? FEEDBACK_AUDIENCES.company
        : FEEDBACK_AUDIENCES.prospect;

    setFormData((current) => ({
      ...current,
      type: FEEDBACK_TYPES[requestedType] ? requestedType : current.type,
      audience: accountAudience,
      requesterEmail: current.requesterEmail || context.user?.email || '',
    }));
  }, [context.accountType, context.user?.email, searchParams]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.title.trim() || !formData.description.trim()) {
      toast.error('Add a title and description before submitting.');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Sending feedback...');

    try {
      await createProductFeedbackSubmission(formData, context);
      setFormData((current) => ({
        ...emptyForm,
        type: current.type,
        audience: current.audience,
        requesterName: current.requesterName,
        requesterEmail: current.requesterEmail,
      }));
      toast.success('Feedback sent. Thank you!', { id: toastId });
    } catch (error) {
      console.error('Error submitting product feedback:', error);
      toast.error('Could not send feedback. Please try again.', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedIcon = formData.type === 'bug' ? BugAntIcon : LightBulbIcon;
  const SelectedIcon = selectedIcon;

  return (
    <div className="bg-gray-50 text-gray-800 min-h-screen">
      <header className="fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-md">
        <div className="container mx-auto px-4">
          <PublicHeader />
        </div>
      </header>

      <main className="pt-24">
        <section className="bg-blue-600 text-white py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl">
              <SelectedIcon className="h-12 w-12 text-blue-100" />
              <h1 className="mt-4 text-4xl md:text-5xl font-bold">Bug Reports & Feature Requests</h1>
              <p className="mt-4 text-lg text-blue-100">
                Send app issues and product ideas directly to the Drip Drop admin team.
              </p>
            </div>
          </div>
        </section>

        <section className="py-14">
          <div className="container mx-auto px-4">
            <form onSubmit={handleSubmit} className="max-w-3xl bg-white p-6 md:p-8 rounded-lg shadow-md">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor="type" className="block text-sm font-semibold text-gray-700 mb-2">
                    Request Type
                  </label>
                  <select
                    id="type"
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="feature">Feature Request</option>
                    <option value="bug">Bug Report</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="audience" className="block text-sm font-semibold text-gray-700 mb-2">
                    I am a
                  </label>
                  <select
                    id="audience"
                    name="audience"
                    value={formData.audience}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.values(FEEDBACK_AUDIENCES).map((audience) => (
                      <option key={audience} value={audience}>{audience}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="requesterName" className="block text-sm font-semibold text-gray-700 mb-2">
                    Name
                  </label>
                  <input
                    id="requesterName"
                    name="requesterName"
                    type="text"
                    value={formData.requesterName}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="requesterEmail" className="block text-sm font-semibold text-gray-700 mb-2">
                    Email
                  </label>
                  <input
                    id="requesterEmail"
                    name="requesterEmail"
                    type="email"
                    value={formData.requesterEmail}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="title" className="block text-sm font-semibold text-gray-700 mb-2">
                    Title
                  </label>
                  <input
                    id="title"
                    name="title"
                    type="text"
                    required
                    value={formData.title}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="priority" className="block text-sm font-semibold text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    id="priority"
                    name="priority"
                    value={formData.priority}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
                    Details
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    required
                    rows="6"
                    value={formData.description}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-6 w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </form>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
