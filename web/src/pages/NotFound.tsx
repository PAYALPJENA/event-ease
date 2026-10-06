import { Link } from 'react-router-dom';

const NotFound = () => (
  <div className="text-center py-24">
    <h1 className="text-2xl font-bold text-gray-900 mb-2">Page not found</h1>
    <p className="text-gray-600 mb-6">The page you're looking for doesn't exist.</p>
    <Link to="/" className="btn btn-primary">Back to Home</Link>
  </div>
);

export default NotFound;
