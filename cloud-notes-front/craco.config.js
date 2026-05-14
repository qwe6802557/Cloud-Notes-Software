const fs = require('fs');
const path = require('path');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const CompressionPlugin = require('compression-webpack-plugin');
const CracoLessPlugin = require('craco-less');
const evalSourceMapMiddleware = require('react-dev-utils/evalSourceMapMiddleware');
const noopServiceWorkerMiddleware = require('react-dev-utils/noopServiceWorkerMiddleware');
const redirectServedPathMiddleware = require('react-dev-utils/redirectServedPathMiddleware');
const paths = require('react-scripts/config/paths');

module.exports = {
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    },
    plugins: [
      process.env.ANALYZE && new BundleAnalyzerPlugin(),
      new CompressionPlugin({
        test: /\.(js|css|html|svg)$/,
        algorithm: 'gzip',
        threshold: 10240,
        minRatio: 0.8
      })
    ].filter(Boolean),
    configure: webpackConfig => {
      if (webpackConfig.mode === 'production') {
        webpackConfig.cache = {
          type: 'filesystem',
          buildDependencies: {
            config: [__filename]
          }
        };
        webpackConfig.target = ['web', 'es2015'];
        webpackConfig.optimization = {
          ...webpackConfig.optimization,
          usedExports: true,
          moduleIds: 'deterministic',
          runtimeChunk: 'single',
          splitChunks: {
            chunks: 'all',
            maxInitialRequests: 30,
            maxAsyncRequests: 30,
            minSize: 20000,
            cacheGroups: {
              antd: {
                name: 'chunk-antd',
                test: /[\\/]node_modules[\\/]antd[\\/]/,
                priority: 10
              },
              reactPackage: {
                name: 'chunk-react',
                test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/,
                priority: 12
              },
              reduxPackage: {
                name: 'chunk-redux',
                test: /[\\/]node_modules[\\/](redux|@reduxjs|react-redux)[\\/]/,
                priority: 11
              },
              echartsReact: {
                name: 'chunk-echarts-react',
                test: /[\\/]node_modules[\\/](echarts-for-react)[\\/]/,
                priority: 10
              },
              vendors: {
                name: 'chunk-vendors',
                test: /[\\/]node_modules[\\/]/,
                priority: -10
              }
            }
          }
        };
        webpackConfig.resolve = {
          ...webpackConfig.resolve,
          fallback: {
            fs: false,
            path: false
          }
        };
      }

      return webpackConfig;
    }
  },
  devServer: devServerConfig => {
    devServerConfig.port = 3000;
    devServerConfig.proxy = {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        pathRewrite: { '^/api': '' }
      }
    };

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      if (!devServer) {
        return middlewares;
      }

      middlewares.unshift(evalSourceMapMiddleware(devServer));

      if (fs.existsSync(paths.proxySetup)) {
        require(paths.proxySetup)(devServer.app);
      }

      middlewares.push(redirectServedPathMiddleware(paths.publicUrlOrPath));
      middlewares.push(noopServiceWorkerMiddleware(paths.publicUrlOrPath));

      return middlewares;
    };

    delete devServerConfig.onBeforeSetupMiddleware;
    delete devServerConfig.onAfterSetupMiddleware;

    return devServerConfig;
  },
  plugins: [
    {
      plugin: CracoLessPlugin,
      options: {
        lessLoaderOptions: {
          lessOptions: {
            javascriptEnabled: true
          }
        },
        babelPluginImportOptions: {
          libraryName: 'antd',
          libraryDirectory: 'es',
          style: true
        }
      }
    }
  ]
};
