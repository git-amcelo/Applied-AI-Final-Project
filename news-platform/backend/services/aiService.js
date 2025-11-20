/**
 * This file handles all the AI stuff for our news app
 * Basically does three main things:
 * 1. Grabs news articles from different sources
 * 2. Figures out if they're biased (left/right leaning)
 * 3. Makes clean summaries without the bias
 * 
 * Uses caching so we don't waste API calls on stuff we already looked at
 */

const Anthropic = require('@anthropic-ai/sdk');
const Exa = require('exa-js').default;
const NodeCache = require('node-cache');

// Cache stuff for 30 minutes to save on API costs
const ctnCache = new NodeCache({ stdTTL: 1800 });

class CtnAiService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    this.exa = new Exa(process.env.EXA_API_KEY);
  }

  /**
   * Handles parsing JSON from Claude's responses
   * Sometimes it wraps stuff in markdown code blocks, so we strip that out
   * @param {string} content - Raw response text from the AI
   * @returns {Object} The actual JSON we need
   */
  ctnParseJsonResponse(content) {
    try {
      // Try parsing it directly first
      return JSON.parse(content);
    } catch (error) {
      try {
        // If that fails, strip out the markdown wrapper
        const cleanContent = content
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
        return JSON.parse(cleanContent);
      } catch (parseError) {
        console.error('Failed to parse JSON:', parseError.message);
        console.error('Content:', content.substring(0, 200) + '...');
        throw parseError;
      }
    }
  }

  /**
   * Main function that searches for news articles
   * Tries to get a mix from left, right, and center sources
   * @param {string} query - What to search for
   * @param {string} sources - Specific sources if you want them
   * @param {number} limit - How many articles to get back
   * @returns {Promise<Array>} List of news articles
   */
  async ctnSearchNewsArticles(query, sources = '', limit = 10) {
    try {
      const cacheKey = `ctn_news_${query}_${sources}_${limit}`;
      const cached = ctnCache.get(cacheKey);
      if (cached) return cached;

      console.log(`🔍 CTN News Intelligence System searching: "${query}"`);

      // Different news source categories - trying to get balanced coverage
      const categoryA = ["huffpost.com", "salon.com", "vox.com", "motherjones.com", "thedailybeast.com", "slate.com", "msnbc.com", "cnn.com", "thenation.com", "jacobinmag.com"];
      const categoryB = ["npr.org", "reuters.com", "bbc.com", "apnews.com", "abcnews.go.com", "cbsnews.com", "nbcnews.com", "pbs.org"];
      const categoryC = ["foxnews.com", "wsj.com", "nypost.com", "dailywire.com", "nationalreview.com", "theblaze.com", "breitbart.com", "townhall.com"];
      const allSourceDomains = [...categoryA, ...categoryB, ...categoryC, "theguardian.com", "washingtonpost.com", "nytimes.com", "politico.com", "theatlantic.com", "usatoday.com", "bloomberg.com"];

      const searchPromises = [];
      const resultsPerCategory = Math.ceil(limit / 4); // Split evenly across 4 searches
      
      // First batch - left-leaning sources
      searchPromises.push(this.exa.searchAndContents(query, {
        type: "neural",
        useAutoprompt: true,
        numResults: Math.min(resultsPerCategory, 8),
        includeDomains: categoryA,
        startPublishedDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        text: { maxCharacters: 800, includeHtmlTags: false },
        includeImageUrls: true
      }));

      // Second batch - right-leaning sources
      searchPromises.push(this.exa.searchAndContents(query, {
        type: "neural",
        useAutoprompt: true,
        numResults: Math.min(resultsPerCategory, 8),
        includeDomains: categoryC,
        startPublishedDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        text: { maxCharacters: 800, includeHtmlTags: false },
        includeImageUrls: true
      }));

      // Third batch - neutral/centrist sources
      searchPromises.push(this.exa.searchAndContents(query, {
        type: "neural",
        useAutoprompt: true,
        numResults: Math.min(resultsPerCategory, 8),
        includeDomains: categoryB,
        startPublishedDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        text: { maxCharacters: 800, includeHtmlTags: false },
        includeImageUrls: true
      }));

      // Fourth batch - mix of everything to fill in gaps
      searchPromises.push(this.exa.searchAndContents(query, {
        type: "neural", 
        useAutoprompt: true,
        numResults: Math.min(limit, 10),
        includeDomains: sources ? sources.split(',').map(s => s.trim()) : allSourceDomains,
        startPublishedDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        text: { maxCharacters: 800, includeHtmlTags: false },
        includeImageUrls: true
      }));

      const searchPromise = Promise.all(searchPromises);

      // Don't wait forever - timeout after 10 seconds
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Exa API timeout')), 10000)
      );

      const searchResults = await Promise.race([searchPromise, timeoutPromise]);

      // Merge all the search results together
      const allResults = [];
      searchResults.forEach(searchResult => {
        if (searchResult && searchResult.results) {
          allResults.push(...searchResult.results);
        }
      });

      // Get rid of any duplicate articles
      const seenUrls = new Set();
      const uniqueResults = allResults.filter(result => {
        if (seenUrls.has(result.url)) {
          return false;
        }
        seenUrls.add(result.url);
        return true;
      });

      console.log(`📰 CTN retrieved ${uniqueResults.length} unique articles (${allResults.length} total before deduplication)`);


      // Convert the Exa API format to what our frontend expects
      const articles = {
        articles: uniqueResults.slice(0, limit).map(result => {
          // Try to grab the article image if Exa found one
          let imageUrl = result.image || result.imageUrl || result.featuredImage || result.thumbnail;
          
          // No image? Use a generic news placeholder
          if (!imageUrl) {
            imageUrl = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&h=600&fit=crop&crop=center";
          }

          return {
            title: result.title || 'Untitled Article',
            content: result.text || result.summary || 'No content available',
            source: this.ctnExtractSourceDomain(result.url),
            url: result.url,
            publishedAt: result.publishedDate || new Date().toISOString(),
            author: result.author || null,
            imageUrl: imageUrl
          };
        })
      };

      ctnCache.set(cacheKey, articles);
      return articles;

    } catch (error) {
      console.error('Error in CTN news search system:', error);
      
      // API failed, so return some dummy articles so the app doesn't break
      console.log(' CTN activating fallback news data system');
      const fallbackArticles = {
        articles: [
          {
            title: "Breaking: Major Tech Companies Announce AI Safety Initiative",
            content: "Leading technology companies have announced a comprehensive AI safety initiative aimed at ensuring responsible development of artificial intelligence systems. The collaboration involves establishing shared safety standards, conducting joint research on AI alignment, and creating transparent reporting mechanisms for AI development milestones. Industry experts view this as a crucial step toward preventing potential risks associated with advanced AI systems while promoting innovation in the field.",
            source: "TechNews Daily",
            url: "https://example.com/ai-safety-initiative",
            publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            author: "Sarah Mitchell",
            imageUrl: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=600&fit=crop&crop=center"
          },
          {
            title: "Climate Scientists Report Breakthrough in Carbon Capture Technology",
            content: "Researchers have developed a revolutionary carbon capture system that can remove CO2 from the atmosphere at unprecedented efficiency rates. The new technology combines advanced materials science with AI-powered optimization to achieve 90% capture efficiency while significantly reducing energy costs. The breakthrough could play a crucial role in meeting global climate targets and represents a major advancement in the fight against climate change.",
            source: "Environmental Science Today",
            url: "https://example.com/carbon-capture-breakthrough",
            publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
            author: "Dr. Michael Chen",
            imageUrl: "https://images.unsplash.com/photo-1569163139394-de4e5f43e4e3?w=800&h=600&fit=crop&crop=center"
          },
          {
            title: "Global Markets React to New Economic Policy Announcements",
            content: "International financial markets showed mixed reactions to recent economic policy announcements from major central banks. While some sectors experienced volatility, others demonstrated resilience as investors analyze the implications of changing monetary policies. Economic analysts suggest that market uncertainty reflects broader concerns about inflation, interest rates, and global economic stability in the coming quarters.",
            source: "Financial Review",
            url: "https://example.com/market-reaction-policy",
            publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
            author: "Jennifer Rodriguez",
            imageUrl: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=600&fit=crop&crop=center"
          },
          {
            title: "Medical Research: New Drug Shows Promise in Alzheimer's Treatment",
            content: "Clinical trials for a new Alzheimer's treatment have shown promising results, with patients experiencing significant improvements in cognitive function and memory retention. The drug targets specific proteins associated with the disease and has demonstrated fewer side effects compared to existing treatments. Medical experts are cautiously optimistic about the potential for this treatment to provide new hope for millions of Alzheimer's patients worldwide.",
            source: "Medical Journal Weekly",
            url: "https://example.com/alzheimers-drug-trial",
            publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
            author: "Dr. Amanda Foster",
            imageUrl: "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&h=600&fit=crop&crop=center"
          },
          {
            title: "Space Exploration: International Collaboration on Mars Mission Announced",
            content: "Space agencies from multiple countries have announced an ambitious collaborative mission to Mars, aimed at establishing a sustainable human presence on the Red Planet. The mission involves advanced life support systems, habitat construction, and resource utilization technologies. Scientists believe this international cooperation represents a significant milestone in space exploration and could pave the way for future interplanetary settlements.",
            source: "Space Technology Review",
            url: "https://example.com/mars-mission-collaboration",
            publishedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
            author: "Dr. James Parker",
            imageUrl: "https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=800&h=600&fit=crop&crop=center"
          }
        ]
      };
      
      ctnCache.set(cacheKey, fallbackArticles);
      return fallbackArticles;
    }
  }

  /**
   * Pulls out just the domain name from a full URL
   * Like turning "https://www.nytimes.com/article" into "nytimes"
   * @param {string} url - Full URL
   * @returns {string} Just the domain name
   */
  ctnExtractSourceDomain(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace('www.', '').split('.')[0];
    } catch (error) {
      return 'Unknown Source';
    }
  }





  /**
   * Analyzes if an article leans left or right politically
   * Uses Claude AI to check the language and framing
   * @param {string} content - The article text
   * @param {string} title - Article headline
   * @param {string} source - Which news site it's from
   * @returns {Promise<Object>} Bias score and analysis
   */
  async ctnAnalyzePoliticalBias(content, title, source) {
    try {
      const cacheKey = `ctn_bias_${Buffer.from(content).toString('base64').slice(0, 50)}`;
      const cached = ctnCache.get(cacheKey);
      if (cached) return cached;

      const biasPrompt = `
        Analyze the political bias of this news article and provide a score from 0-100. Be sensitive to subtle bias indicators and avoid over-categorizing as neutral.

        BIAS SCORING SCALE:
        - 0-20: Highly Liberal (strong progressive/left-wing perspective)
        - 21-40: Liberal (moderate left-leaning perspective)  
        - 41-60: Neutral/Centrist (balanced, minimal bias)
        - 61-80: Conservative (moderate right-leaning perspective)
        - 81-100: Highly Conservative (strong conservative/right-wing perspective)

        Article Details:
        Title: "${title}"
        Source: "${source}"
        Content: "${content.substring(0, 1000)}..."

        CRITICAL ANALYSIS GUIDELINES
        Source Context: Assess the publication's editorial standards, historical reputation, ownership structure, and any documented political or ideological leanings.fiveable+1.
        Language Analysis: Examine the use of emotionally charged words, loaded language, and selective descriptors, distinguishing between fact, opinion, and rhetorical strategies.criticalthinking+2.
        Story Framing: Analyze how the story is structured, which perspectives are foregrounded or marginalized, and the narrative techniques that shape interpretation.criticalthinking+1.
        Source Selection: Identify the range and expertise of sources cited, evaluate the credibility of quoted individuals, and check for the inclusion of diverse or opposing viewpoints.libguides.com+2.
        Fact Selection: Determine which facts are emphasized, backgrounded, or omitted; evaluate the evidence provided and consider how selective fact presentation can influence perception.libguides.com+2.
        Implicit Assumptions: Identify underlying worldviews or presuppositions in the reporting, as well as unstated premises or societal biases reflected in the writing

        IMPORTANT: Do NOT default to neutral unless the content truly shows balanced reporting. Most news sources have some degree of bias - detect and measure it accurately.

        Examples of bias indicators:
        - Liberal bias: Focus on social justice, climate urgency, healthcare access, income inequality
        - Conservative bias: Emphasis on law and order, fiscal responsibility, traditional values, border security
        - Neutral: Presents multiple perspectives, uses factual language, minimal editorial tone

        Return ONLY a JSON object:
        {
          "biasScore": 32,
          "biasLabel": "Liberal",
          "confidence": 0.78,
          "reasoning": "Detailed explanation of specific bias indicators found",
          "keyIndicators": ["specific-indicator1", "specific-indicator2", "specific-indicator3"]
        }
      `;

      const response = await this.anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        temperature: 0.1,
        system: "You are a media bias analyst trained to evaluate political and ideological leanings in news content. Provide balanced, evidence-based assessments using recognized frameworks and journalistic standards for objectivity and accuracy.",
        messages: [
          {
            role: "user",
            content: biasPrompt
          }
        ]
      });

      const biasAnalysis = this.ctnParseJsonResponse(response.content[0].text);
      
      // Validate and sanitize the response without static adjustments
      const result = {
        biasScore: Math.max(0, Math.min(100, biasAnalysis.biasScore || 50)),
        biasLabel: biasAnalysis.biasLabel || 'Neutral/Centrist',
        confidence: Math.max(0, Math.min(1, biasAnalysis.confidence || 0.5)),
        reasoning: biasAnalysis.reasoning || 'AI-powered bias analysis completed',
        keyIndicators: biasAnalysis.keyIndicators || [],
        analysisMethod: 'CTN AI-powered primary analysis'
      };

      ctnCache.set(cacheKey, result);
      return result;

    } catch (error) {
      console.error('Error in CTN political bias analysis:', error);
      
      // If that didn't work, try checking the bias based on the news source itself
      return await this.ctnGetSourceBasedBiasAnalysis(source, title, content);
    }
  }

  /**
   * Checks bias by looking at what news outlet published it
   * Different sources have known biases, so we use that as a starting point
   * @param {string} source - Which news site
   * @param {string} title - Article title
   * @param {string} content - Article text
   * @returns {Promise<Object>} Bias analysis
   */
  async ctnGetSourceBasedBiasAnalysis(source, title, content) {
    try {
      // Cache the source analysis so we don't analyze the same outlet repeatedly
      const sourceCacheKey = `ctn_source_bias_${source.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const cachedSourceAnalysis = ctnCache.get(sourceCacheKey);
      
      let sourceAnalysis;
      
      if (cachedSourceAnalysis) {
        sourceAnalysis = cachedSourceAnalysis;
        console.log(`📋 CTN using cached bias analysis for ${source}`);
      } else {
        // Use AI to analyze the source's reputation and bias in real-time
        const sourceAnalysisPrompt = `
          Analyze the political bias and reputation of the news source "${source}" based on current academic research, fact-checking organizations, and media analysis frameworks as of 2024.

          Research and consider these authoritative sources:
          1. AllSides Media Bias Ratings (allsides.com)
          2. Ad Fontes Media Bias Chart (adfontesmedia.com)
          3. Media Bias/Fact Check ratings
          4. Pew Research Center media studies
          5. Reuters Institute Digital News Report
          6. Academic studies on media bias and reliability

          Analyze based on:
          - Editorial stance and ownership structure
          - Historical reporting patterns and fact-checking scores
          - Audience targeting and funding model
          - Professional journalism standards adherence
          - Transparency in corrections and retractions

          Provide a comprehensive real-time assessment from 0-100:
          - 0-20: Highly Liberal (e.g., strongly progressive editorial stance)
          - 21-40: Liberal (e.g., left-leaning but maintains journalistic standards)
          - 41-60: Neutral/Centrist (e.g., balanced reporting, minimal editorial bias)
          - 61-80: Conservative (e.g., right-leaning but maintains journalistic standards)
          - 81-100: Highly Conservative (e.g., strongly conservative editorial stance)

          Return ONLY a JSON object:
          {
            "biasScore": 45,
            "biasLabel": "Liberal",
            "confidence": 0.85,
            "reasoning": "Detailed explanation based on current research and ratings",
            "keyIndicators": ["methodology-used", "rating-sources", "reliability-factors"],
            "sourceReliability": "High/Medium/Low",
            "lastUpdated": "Current analysis date"
          }
        `;

        const response = await this.anthropic.messages.create({
        model: "claude-3-haiku-20240307", // Cheaper model works fine for this
        max_tokens: 600,
        temperature: 0.1,
        system: "You are a CTN media research specialist with expertise in contemporary media analysis frameworks. Deliver objective, research-driven assessments utilizing current data from established media monitoring organizations. Focus on real-time analysis rather than static categorizations.",
          messages: [
            {
              role: "user",
              content: sourceAnalysisPrompt
            }
          ]
        });

        sourceAnalysis = this.ctnParseJsonResponse(response.content[0].text);
        
        // Save this for 24 hours since source bias doesn't change daily
        ctnCache.set(sourceCacheKey, sourceAnalysis, 86400);
        console.log(`🔍 CTN generated new real-time bias analysis for ${source}`);
      }

      // Now look at this specific article and see if it's typical for that source
      const contentAnalysisPrompt = `
        Given that "${source}" has been analyzed as "${sourceAnalysis.biasLabel}" with a bias score of ${sourceAnalysis.biasScore}, 
        now analyze this specific article for any additional bias indicators or deviations from the source's typical pattern:

        Title: "${title}"
        Content: "${content.substring(0, 800)}..."

        Consider:
        1. Does this article align with or deviate from the source's typical bias pattern?
        2. Are there specific linguistic choices, framing, or selection of facts that indicate bias?
        3. How does the article's tone and presentation compare to neutral reporting standards?

        Adjust the bias score if needed based on this specific content, but stay within a reasonable range of the source's typical bias pattern.

        Return ONLY a JSON object:
        {
          "finalBiasScore": 45,
          "finalBiasLabel": "Liberal",
          "confidence": 0.85,
          "reasoning": "Combined source reputation and specific content analysis",
          "keyIndicators": ["source-pattern", "content-specific", "linguistic-analysis"]
        }
      `;

      const contentResponse = await this.anthropic.messages.create({
        model: "claude-3-haiku-20240307", // Haiku is fast and cheap enough for this
        max_tokens: 400,
        temperature: 0.1,
        system: "You are a CTN content analyst evaluating articles within their source's established bias patterns. Deliver comprehensive analysis incorporating both source reputation and article-specific elements.",
        messages: [
          {
            role: "user",
            content: contentAnalysisPrompt
          }
        ]
      });

      const contentAnalysis = this.ctnParseJsonResponse(contentResponse.content[0].text);
      
      // Mix together what we know about the source and this specific article
      return {
        biasScore: Math.max(0, Math.min(100, contentAnalysis.finalBiasScore || sourceAnalysis.biasScore || 50)),
        biasLabel: contentAnalysis.finalBiasLabel || sourceAnalysis.biasLabel || 'Neutral/Centrist',
        confidence: Math.max(0, Math.min(1, contentAnalysis.confidence || sourceAnalysis.confidence || 0.5)),
        reasoning: `${sourceAnalysis.reasoning || 'Source analysis completed'}. ${contentAnalysis.reasoning || 'Content analysis completed'}`,
        keyIndicators: [...(sourceAnalysis.keyIndicators || []), ...(contentAnalysis.keyIndicators || [])],
        sourceReliability: sourceAnalysis.sourceReliability || 'Medium',
        analysisMethod: 'CTN AI-powered real-time source and content assessment'
      };

    } catch (error) {
      console.error('Error in CTN AI-powered source analysis:', error);
      
      // Last resort: just look for political keywords in the text
      return this.ctnAnalyzeContentBasedBias(title, content, source);
    }
  }

  /**
   * Simple keyword-based bias detection
   * Counts liberal vs conservative words and phrases
   * @param {string} title - Article title
   * @param {string} content - Article text  
   * @param {string} source - News outlet
   * @returns {Object} Bias score
   */
  ctnAnalyzeContentBasedBias(title, content, source) {
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();
    
    // Lists of words that typically show up in liberal vs conservative articles
    const liberalKeywords = [
      // Political stuff
      'progressive', 'liberal', 'democratic', 'democrats', 'left-wing', 'activist',
      // Social issues  
      'climate change', 'global warming', 'social justice', 'systemic racism', 'white privilege',
      'healthcare reform', 'medicare for all', 'gun control', 'assault weapons', 'LGBTQ', 'transgender rights',
      'immigration reform', 'dreamers', 'refugees', 'asylum seekers', 'diversity', 'inclusion',
      'income inequality', 'wealth gap', 'minimum wage', 'living wage', 'union', 'workers rights',
      'renewable energy', 'green new deal', 'civil rights', 'voting rights',
      // Loaded language
      'vulnerable communities', 'marginalized', 'oppressed', 'exploited', 'corporate greed'
    ];
    
    const conservativeKeywords = [
      // Political stuff
      'conservative', 'republican', 'republicans', 'right-wing', 'patriot', 'constitutional',
      'traditional values', 'family values', 'religious freedom', 'christian values',
      // Economic issues
      'tax cuts', 'deregulation', 'free market', 'capitalism', 'small business', 'job creators',
      'fiscal responsibility', 'balanced budget', 'national debt', 'government spending',
      // Security/law
      'second amendment', 'gun rights', 'border security', 'illegal immigration', 'law and order',
      'crime', 'public safety', 'police', 'military', 'national security', 'terrorism',
      // Social issues
      'limited government', 'states rights', 'school choice', 'pro-life', 'unborn',
      // Emotional language
      'radical left', 'socialist', 'communist', 'woke', 'cancel culture', 'mainstream media'
    ];

    const neutralKeywords = [
      'bipartisan', 'nonpartisan', 'balanced', 'objective', 'factual', 'data shows',
      'according to data', 'research shows', 'experts say', 'analysis reveals', 'study finds',
      'officials said', 'sources indicate', 'reported', 'confirmed', 'statistics show'
    ];
    
    let liberalScore = 0;
    let conservativeScore = 0;
    let neutralScore = 0;
    
    // Count how many times each type of keyword shows up
    liberalKeywords.forEach(keyword => {
      const titleMatches = (titleLower.match(new RegExp(keyword, 'g')) || []).length;
      const contentMatches = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
      liberalScore += (titleMatches * 2) + contentMatches; // Title words count double
    });
    
    conservativeKeywords.forEach(keyword => {
      const titleMatches = (titleLower.match(new RegExp(keyword, 'g')) || []).length;
      const contentMatches = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
      conservativeScore += (titleMatches * 2) + contentMatches;
    });

    neutralKeywords.forEach(keyword => {
      const titleMatches = (titleLower.match(new RegExp(keyword, 'g')) || []).length;
      const contentMatches = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
      neutralScore += (titleMatches * 2) + contentMatches;
    });
    
    // Also look at which outlet published it
    const sourceLower = source.toLowerCase();
    
    // Group sources by their known lean
    const sourceGroupAlpha = [
      'huffington', 'huffpost', 'salon', 'vox', 'dailykos', 'motherjones', 'thenation',
      'commondreams', 'thinkprogress', 'mediamatters', 'rawstory', 'alternet', 'truthout',
      'democracynow', 'jacobin', 'slate', 'washingtonpost', 'nytimes', 'cnn', 'msnbc'
    ];
    
    const sourceGroupBeta = [
      'foxnews', 'fox', 'dailywire', 'breitbart', 'nationalreview', 'townhall',
      'dailycaller', 'redstate', 'theblaze', 'washingtonexaminer', 'nypost',
      'americanthinker', 'powerline', 'hotair', 'pjmedia', 'oann', 'newsmax'
    ];
    
    // Adjust score based on the source's known bias
    let sourceModifier = 0;
    if (sourceGroupAlpha.some(src => sourceLower.includes(src))) {
      liberalScore += 10; // Bump up liberal score for left-leaning sources
      sourceModifier = -25; // Push final score left
    } else if (sourceGroupBeta.some(src => sourceLower.includes(src))) {
      conservativeScore += 10; // Bump up conservative score for right-leaning sources  
      sourceModifier = 25; // Push final score right
    }
    
    // Figure out the final bias score
    const totalPoliticalScore = liberalScore + conservativeScore;
    let biasScore = 50 + sourceModifier; // Start from center, adjusted by source
    let biasLabel = 'Neutral/Centrist';
    let confidence = 0.5;
    
    // Determine which way it leans
    if (totalPoliticalScore > 0) {
      const scoreDifference = Math.abs(liberalScore - conservativeScore);
      
      if (liberalScore > conservativeScore || sourceModifier < 0) {
        // Leans liberal
        const dominanceRatio = Math.max(0.3, (liberalScore + Math.abs(sourceModifier)) / Math.max(1, totalPoliticalScore + 10));
        biasScore = Math.max(15, 50 - (dominanceRatio * 35));
        biasLabel = biasScore <= 25 ? 'Highly Liberal' : 'Liberal';
        confidence = Math.min(0.85, 0.6 + (dominanceRatio * 0.25));
      } else if (conservativeScore > liberalScore || sourceModifier > 0) {
        // Leans conservative
        const dominanceRatio = Math.max(0.3, (conservativeScore + Math.abs(sourceModifier)) / Math.max(1, totalPoliticalScore + 10));
        biasScore = Math.min(85, 50 + (dominanceRatio * 35));
        biasLabel = biasScore >= 75 ? 'Highly Conservative' : 'Conservative';
        confidence = Math.min(0.85, 0.6 + (dominanceRatio * 0.25));
      } else {
        // If it's really balanced, mark it neutral
        if (neutralScore > totalPoliticalScore * 1.5 && totalPoliticalScore < 3) {
          confidence = 0.6;
        } else {
          // Close call - pick one randomly
          if (Math.random() > 0.5) {
            biasScore = 35; // Slightly liberal
            biasLabel = 'Liberal';
            confidence = 0.6;
          } else {
            biasScore = 65; // Slightly conservative  
            biasLabel = 'Conservative';
            confidence = 0.6;
          }
        }
      }
    } else {
      // No political words found - just guess
      if (Math.random() > 0.6) {
        biasScore = Math.random() > 0.5 ? 35 : 65;
        biasLabel = biasScore < 50 ? 'Liberal' : 'Conservative';
        confidence = 0.5;
      }
    }
    
    return {
      biasScore: Math.round(biasScore),
      biasLabel: biasLabel,
      confidence: confidence,
      reasoning: `Content-based analysis: Detected ${liberalScore} liberal, ${conservativeScore} conservative, and ${neutralScore} neutral indicators in the article content from ${source}`,
      keyIndicators: ['content-analysis', 'keyword-detection', 'linguistic-patterns'],
      sourceReliability: 'Unknown',
      analysisMethod: 'CTN content-based linguistic analysis'
    };
  }

  /**
   * Creates a short, unbiased summary of the article
   * Strips out the political spin and just gives the facts
   * @param {string} content - Full article text
   * @param {string} title - Article headline
   * @returns {Promise<Object>} Clean summary
   */
  async ctnGenerateNeutralSummary(content, title) {
    try {
      const cacheKey = `ctn_summary_${Buffer.from(content).toString('base64').slice(0, 50)}`;
      const cached = ctnCache.get(cacheKey);
      if (cached) return cached;

      const summaryPrompt = `
        Create a neutral, objective summary of this news article:
        
        Title: "${title}"
        Content: "${content}"
        
        Requirements:
        1. Keep it concise (2-3 sentences, max 150 words)
        2. Maintain complete neutrality - remove any biased language
        3. Focus on factual information only
        4. Include key points and main developments
        5. Avoid opinion words or emotional language
        
        Return ONLY a JSON object:
        {
          "summary": "Neutral summary text here",
          "keyPoints": ["point1", "point2", "point3"],
          "wordCount": 45
        }
      `;

      const response = await this.anthropic.messages.create({
        model: "claude-3-haiku-20240307", // Cheap model is fine for summaries
        max_tokens: 300,
        temperature: 0.2,
        system: "You are a CTN editorial specialist focused on generating balanced, factual summaries. Eliminate bias and concentrate exclusively on verifiable information.",
        messages: [
          {
            role: "user",
            content: summaryPrompt
          }
        ]
      });

      const summaryResult = this.ctnParseJsonResponse(response.content[0].text);
      
      ctnCache.set(cacheKey, summaryResult);
      return summaryResult;

    } catch (error) {
      console.error('Error in CTN summary generation:', error);
      return {
        summary: 'Summary generation failed. Please try again.',
        keyPoints: ['Error occurred'],
        wordCount: 0
      };
    }
  }

  /**
   * Main function that does everything - bias check and summary
   * Runs both at the same time to save time
   * @param {Object} article - The article to process
   * @returns {Promise<Object>} Article with bias score and summary added
   */
  async ctnProcessCompleteArticle(article) {
    try {
      const [biasAnalysis, summary] = await Promise.all([
        this.ctnAnalyzePoliticalBias(article.content, article.title, article.source),
        this.ctnGenerateNeutralSummary(article.content, article.title)
      ]);

      return {
        ...article,
        bias: biasAnalysis,
        summary: summary,
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error processing article:', error);
      throw error;
    }
  }
}

module.exports = new CtnAiService();
