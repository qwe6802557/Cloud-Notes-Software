import React from 'react';
import { Home, Settings, User } from 'lucide-react';

const HomePage = () => {
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Navigation Bar */}
            <nav className="bg-white shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <Home className="h-6 w-6 text-gray-500" />
                            <span className="ml-2 text-xl font-semibold text-gray-900">My Electron App</span>
                        </div>
                        <div className="flex items-center space-x-4">
                            <button className="p-2 rounded-lg hover:bg-gray-100">
                                <Settings className="h-5 w-5 text-gray-500" />
                            </button>
                            <button className="p-2 rounded-lg hover:bg-gray-100">
                                <User className="h-5 w-5 text-gray-500" />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="bg-white rounded-lg shadow p-6">
                    <h1 className="text-2xl font-bold text-gray-900 mb-4">
                        Welcome to Your Desktop App
                    </h1>
                    <p className="text-gray-600 mb-6">
                        This is your new Electron + React application. Start building something amazing!
                    </p>

                    {/* Quick Actions Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                            <h2 className="text-lg font-semibold text-blue-900 mb-2">Getting Started</h2>
                            <p className="text-blue-600">Learn how to use the application and explore its features.</p>
                        </div>
                        <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                            <h2 className="text-lg font-semibold text-green-900 mb-2">Recent Projects</h2>
                            <p className="text-green-600">View and manage your recent projects.</p>
                        </div>
                        <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                            <h2 className="text-lg font-semibold text-purple-900 mb-2">Resources</h2>
                            <p className="text-purple-600">Access helpful resources and documentation.</p>
                        </div>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="bg-white border-t mt-8">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <p className="text-center text-gray-500 text-sm">
                        © 2025 Your App Name. All rights reserved.
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default HomePage;
