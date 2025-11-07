import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, RefreshCw, ExternalLink, Clock } from 'lucide-react';
import { newsApi } from '../services/api';
import BiasIndicator, { BiasBadge } from '../components/BiasIndicator';
import { formatDate, truncateText } from '../utils/helpers';
import toast from 'react-hot-toast';

const NewsPage = () => {
  const [articles, setArticles] = useState([]);
  const [filteredArticles, setFilteredArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [biasFilter, setBiasFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedArticles, setExpandedArticles] = useState(new Set());
  const articlesPerPage = 9;

  useEffect(() => {
    loadNews();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const timeoutId = setTimeout(() => {
        loadNews(searchQuery);
      }, 500);
      return () => clearTimeout(timeoutId);
    } else {
      loadNews();
    }
  }, [searchQuery]);

  // Filter articles based on bias filter
  useEffect(() => {
    let filtered = articles;
    
    if (biasFilter !== 'all') {
      filtered = articles.filter(article => {
        const biasScore = article.bias?.biasScore || 50;
        switch (biasFilter) {
          case 'liberal':
            return biasScore <= 40;
          case 'center':
            return biasScore >= 41 && biasScore <= 60;
          case 'conservative':
            return biasScore >= 61;
          default:
            return true;
        }
      });
    }
    
    setFilteredArticles(filtered);
    setCurrentPage(1); // Reset to first page when filter changes
  }, [articles, biasFilter]);

  const loadNews = async (query = 'latest news') => {
    try {
      setLoading(true);
      const response = await newsApi.searchNews(query, '', 20);
      setArticles(response.articles || []);
    } catch (error) {
      console.error('Failed to load news:', error);
      toast.error('Failed to load news articles');
    } finally {
      setLoading(false);
    }
  };

  // Pagination helpers
  const totalPages = Math.ceil(filteredArticles.length / articlesPerPage);
  const startIndex = (currentPage - 1) * articlesPerPage;
  const endIndex = startIndex + articlesPerPage;
  const currentArticles = filteredArticles.slice(startIndex, endIndex);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFilterChange = (filter) => {
    setBiasFilter(filter);
  };

  const handleRefresh = () => {
    loadNews(searchQuery || 'latest news');
  };

  const toggleExpandArticle = (index) => {
    const newExpanded = new Set(expandedArticles);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedArticles(newExpanded);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Search and Refresh */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search Bar */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search news articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-5 w-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Bias Filter */}
      {/* <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-gray-700">Filter by Bias:</span>
            <div className="flex space-x-2">
              <button
                onClick={() => handleFilterChange('all')}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  biasFilter === 'all'
                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                }`}
              >
                All ({articles.length})
              </button>
              <button
                onClick={() => handleFilterChange('liberal')}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  biasFilter === 'liberal'
                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                }`}
              >
                Liberal ({articles.filter(a => (a.bias?.biasScore || 50) <= 40).length})
              </button>
              <button
                onClick={() => handleFilterChange('center')}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  biasFilter === 'center'
                    ? 'bg-green-100 text-green-800 border-green-200'
                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                }`}
              >
                Center ({articles.filter(a => {
                  const score = a.bias?.biasScore || 50;
                  return score >= 41 && score <= 60;
                }).length})
              </button>
              <button
                onClick={() => handleFilterChange('conservative')}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  biasFilter === 'conservative'
                    ? 'bg-red-100 text-red-800 border-red-200'
                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                }`}
              >
                Conservative ({articles.filter(a => (a.bias?.biasScore || 50) >= 61).length})
              </button>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Showing {currentArticles.length} of {filteredArticles.length} articles
          </div>
        </div>
      </div> */}

      {/* Articles Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden animate-pulse">
              <div className="h-48 bg-gray-200"></div>
              <div className="p-6">
                <div className="h-6 bg-gray-200 rounded mb-3"></div>
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-4 bg-gray-200 rounded mb-4 w-3/4"></div>
                <div className="flex justify-between items-center">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-6 bg-gray-200 rounded-full w-20"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-500 mb-4">
            {biasFilter === 'all' ? 'No articles found' : `No ${biasFilter} articles found`}
          </div>
          <button
            onClick={() => handleFilterChange('all')}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Show all articles
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {currentArticles.map((article, index) => (
            <motion.div
              key={index}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: index * 0.05, duration: 0.4 }}
              className="bg-white rounded-lg shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden flex flex-col h-full"
            >
              {/* Article Image */}
              {article.imageUrl && (
                <div className="w-full h-48 bg-gray-200 flex-shrink-0">
                  <img
                    src={article.imageUrl}
                    alt={article.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.style.display = 'none';
                    }}
                  />
                </div>
              )}
              
              <div className="p-4 flex flex-col flex-1">
                {/* Header with Bias Badge */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                    <span className="font-medium text-blue-600 uppercase tracking-wide">{article.source}</span>
                    <span>•</span>
                    <span className="flex items-center">
                      <Clock className="h-3 w-3 mr-1" />
                      {formatDate(article.publishedAt)}
                    </span>
                  </div>
                  <BiasBadge biasScore={article.bias?.biasScore} />
                </div>

                {/* Title */}
                <h3 className="text-lg font-bold text-gray-900 mb-2 leading-tight line-clamp-2">
                  {article.title}
                </h3>

                {/* Author */}
                {article.author && (
                  <p className="text-xs text-gray-500 mb-2">by {article.author}</p>
                )}

                {/* Content */}
                {/* <div className="text-sm text-gray-700 mb-4 flex-1">
                  <p className={expandedArticles.has(index) ? '' : 'line-clamp-3'}>
                    {expandedArticles.has(index) 
                      ? (article.summary?.summary || article.content || article.description)
                      : truncateText(article.summary?.summary || article.content || article.description, 150)
                    }
                  </p>
                  {(article.summary?.summary || article.content || article.description) && 
                   (article.summary?.summary || article.content || article.description).length > 150 && (
                    <button
                      onClick={() => toggleExpandArticle(index)}
                      className="text-blue-600 hover:text-blue-700 text-xs font-medium mt-1 focus:outline-none"
                    >
                      {expandedArticles.has(index) ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div> */}

                {/* Bias Analysis - Compact */}
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-700">
                      Bias Score: {article.bias?.biasScore || 50}/100
                    </span>
                    {article.bias?.confidence && (
                      <span className="text-xs text-gray-500">
                      Confidence:   {Math.round(article.bias.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  <BiasIndicator
                    biasScore={article.bias?.biasScore}
                    confidence={article.bias?.confidence}
                    size="large"
                    showLabel={true}
                  />
                  {article.bias?.reasoning && (
                    <p className="text-xs text-gray-600 mt-2 line-clamp-2">
                      {article.bias.reasoning}
                    </p>
                  )}
                </div>

                {/* Read More Link */}
                {/* {article.url && (
                  <div className="mt-auto">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-600 hover:text-blue-700 text-sm font-medium group"
                    >
                      Read Full Article
                      <ExternalLink className="h-3 w-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                    </a>
                  </div>
                )} */}
              </div>
            </motion.div>
          ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center space-x-2 mt-8">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              
              {[...Array(totalPages)].map((_, index) => {
                const page = index + 1;
                return (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`px-3 py-2 text-sm rounded-md transition-colors ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NewsPage;
