const path = require('path');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const CompressionPlugin = require('compression-webpack-plugin');
const CracoLessPlugin = require('craco-less');

module.exports = {
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    plugins: [
      // 分析打包结果的可视化工具
      process.env.ANALYZE && new BundleAnalyzerPlugin(),
      // 压缩
      new CompressionPlugin({
        test: /\.(js|css|html|svg)$/,
        algorithm: 'gzip',
        threshold: 10240,
        minRatio: 0.8
      })
    ].filter(Boolean),
    // 条件性地添加BundleAnalyzerPlugin，只有当环境变量ANALYZE为true时才会启用
    // CompressionPlugin：配置文件压缩
    // test：指定哪些文件类型需要压缩
    // algorithm：使用gzip算法压缩
    // threshold：只压缩大于10KB的文件
    // minRatio：只有压缩率小于0.8的文件才会被压缩
    // filter(Boolean)：过滤掉数组中的false/undefined值，确保ANALYZE为false时不会添加分析插件
    configure: (webpackConfig) => {
      if (webpackConfig.mode === 'production') {
        // 持久化缓存
        webpackConfig.cache = {
          type: 'filesystem',
          buildDependencies: {
            config: [__filename],
          },
        };
        // 启用Webpack 5的持久化缓存功能：
        // type: 'filesystem'：使用文件系统缓存而非内存缓存
        // buildDependencies.config：指定当前配置文件变更时需要重新构建缓存

        // 设置构建目标为现代浏览器
        webpackConfig.target = ['web', 'es2015'];
        // 设置构建目标为现代浏览器，允许使用ES2015+特性，可以生成更小更高效的代码

        // 分包策略
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
        // usedExports: true：启用Tree Shaking，移除未使用的代码
        // `moduleIds: 'deterministic'：确保模块ID在不同构建间保持一致，提高缓存效率
        // runtimeChunk: 'single'：将运行时代码提取到单独的chunk中，改善缓存

        // splitChunks:
        // chunks: 'all'：对所有类型的代码块进行分割
        // maxInitialRequests/maxAsyncRequests: 30：允许更多的并行请求，提高加载性能
        // minSize: 20000：只有大于约20KB的模块才会被分割

        // cacheGroups: 缓存组配置, 用于指定如何分割代码
        // antd组：将Ant Design库的代码打包到一个名为chunk-antd的文件中
        // test：通过正则表达式匹配路径中包含node_modules/antd的模块
        // priority: 10：该规则的优先级，数字越大优先级越高

        // 模块解析
        webpackConfig.resolve = {
          ...webpackConfig.resolve,
          fallback: {
            fs: false,
            path: false,
          }
        };
        // fallback：指定某些Node.js核心模块的替代方案
        // 设置fs和path为false，表示这些Node.js核心模块在浏览器环境中不需要polyfill，减小打包体积
      }
      return webpackConfig;
    }
  },
  devServer: {
    // 开发环境的配置
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://10.15.2.124:46080',  // 线上地址: http://10.217.240.30:8080 测试地址: http://10.15.2.124:46080
        changeOrigin: true,
        pathRewrite: { '^/api': '' },
      },
    },
  },
  plugins: [
    {
      plugin: CracoLessPlugin,
      options: {
        lessLoaderOptions: {
          lessOptions: {
            javascriptEnabled: true,
          },
        },
        babelPluginImportOptions: {
          libraryName: 'antd',
          libraryDirectory: 'es',
          style: true,
        }
      },
    },
    // CracoLessPlugin：处理Less样式文件
    // lessOptions.javascriptEnabled: true：允许在Less文件中使用JavaScript表达式，Ant Design的样式文件需要此选项
    // libraryName: 'antd'：指定要按需加载的库名
    // libraryDirectory: 'es'：使用ES模块
    // style: true：自动引入对应的Less样式文件
  ],
};