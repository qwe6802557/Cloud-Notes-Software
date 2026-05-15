const Joi = require('joi');
const AppError = require('../utils/AppError');

// validate 验证高阶函数
const validate = (schema, dataSourceKey = 'body') => (req, res, next) => {
    let dataToValidate;

    if (dataSourceKey === 'body') {
        dataToValidate = req.body;
    } else if (dataSourceKey === 'query') {
        dataToValidate = req.query;
    } else if (dataSourceKey === 'params') {
        dataToValidate = req.params;
    } else {
        // 无效传参 则默认req.body 并抛出错误
        console.warn(`Invalid dataSourceKey: ${dataSourceKey} provided to validator. Defaulting to 'body'.`);
        dataToValidate = req.body;
    }

    // Joi 验证选项：
    // abortEarly: false - 收集所有错误，而不是在第一个错误时停止
    // allowUnknown: true - 允许对象包含 schema 中未定义的键 (对 query 和 params 特别有用)
    const validationOptions = {
        abortEarly: false,
        allowUnknown: true
    };

    const { error } = schema.validate(dataToValidate, validationOptions);

    if (error) {
        const errorMessages = error.details.map(detail => detail.message).join(', ');
        return next(new AppError(errorMessages, 400));
    }

    next();
};

// 定义验证模式
const schemas = {
    // 用户注册验证
    userRegister: Joi.object({
        username: Joi.string().trim().pattern(/^[a-zA-Z0-9]{3,50}$/).required()
            .messages({
                'string.pattern.base': '用户名只能包含字母和数字',
                'string.min': '用户名至少需要3个字符',
                'string.max': '用户名最多50个字符',
                'any.required': '用户名不能为空',
                'string.empty': '用户名不能为空'
            }),
        email: Joi.string().email().required()
            .messages({
                'string.email': '请输入有效的邮箱地址',
                'any.required': '邮箱不能为空',
                'string.empty': '邮箱不能为空'
            }),
        phone: Joi.string().pattern(/^1[3-9]\d{9}$/).allow('', null)
            .messages({
                'string.pattern.base': '请输入有效的手机号'
            }),
        password: Joi.string().min(6).required()
            .messages({
                'string.min': '密码至少需要6个字符',
                'any.required': '密码不能为空',
                'string.empty': '密码不能为空'
            }),
        confirmPassword: Joi.string().valid(Joi.ref('password')).required()
            .messages({
                'any.only': '两次输入的密码不一致',
                'any.required': '请确认密码',
                'string.empty': '确认密码不能为空'
            }),
        verificationCode: Joi.string().length(6).required()
            .messages({
                'string.length': '验证码必须是6位数字',
                'any.required': '验证码不能为空',
                'string.empty': '验证码不能为空'
            })
    }),

    // 用户登录验证
    userLogin: Joi.object({
        account: Joi.string().trim().required()
            .messages({
                'any.required': '账号不能为空',
                'string.empty': '账号不能为空'
            }),
        password: Joi.string().min(6).required()
            .messages({
                'string.min': '密码至少需要6个字符',
                'any.required': '密码不能为空',
                'string.empty': '密码不能为空'
            })
    }),
    userUpdate: Joi.object({
        username: Joi.string().trim().pattern(/^[a-zA-Z0-9]{3,50}$/)
            .messages({
                'string.pattern.base': '用户名只能包含字母和数字',
                'string.min': '用户名至少需要3个字符',
                'string.max': '用户名最多50个字符',
                'string.empty': '用户名不能为空'
            }),

        password: Joi.string().min(6).allow('', null)
            .messages({
                'string.min': '密码至少需要6个字符'
            }),
        avatar: Joi.string().max(5 * 1024 * 1024).allow('', null)
            .messages({
                'string.max': '头像文件过大'
            })
    }),
    // 用户名+密码登录验证
    accountLogin: Joi.object({
        username: Joi.string().trim().pattern(/^[a-zA-Z0-9]{3,50}$/).required()
            .messages({
                'string.pattern.base': '用户名只能包含字母和数字',
                'string.min': '用户名至少需要3个字符',
                'string.max': '用户名最多50个字符',
                'any.required': '用户名不能为空',
                'string.empty': '用户名不能为空'
            }),
        password: Joi.string().min(6).required()
            .messages({
                'string.min': '密码至少需要6个字符',
                'any.required': '密码不能为空',
                'string.empty': '密码不能为空'
            }),
        captcha: Joi.string().length(4).required() // 假设图形验证码为4位
            .messages({
                'string.length': '验证码不正确',
                'any.required': '验证码不能为空',
                'string.empty': '验证码不能为空'
            })
    }),
    // 笔记本创建验证
    notebookCreate: Joi.object({
        name: Joi.string().trim().max(100).required()
            .messages({
                'string.max': '笔记本名称最多100个字符',
                'any.required': '笔记本名称不能为空'
            }),
        description: Joi.string().trim().max(500).allow('', null)
            .messages({
                'string.max': '描述最多500个字符'
            }),
        isDefault: Joi.boolean()
    }),

    // 笔记创建验证
    noteCreate: Joi.object({
        title: Joi.string().trim().max(200).required()
            .messages({
                'string.max': '标题最多200个字符',
                'any.required': '标题不能为空'
            }),
        content: Joi.string().allow('').required()
            .messages({
                'any.required': '内容不能为空'
            }),
        notebookId: Joi.string().required()
            .messages({
                'any.required': '必须指定笔记本'
            }),
        tags: Joi.array().items(Joi.string()),
    }),

    // 发送验证码验证
    sendVerificationCode: Joi.object({
        email: Joi.string().email().required()
            .messages({
                'string.email': '请输入有效的邮箱地址',
                'any.required': '邮箱不能为空',
                'string.empty': '邮箱不能为空'
            })
    })
};

module.exports = {
    validate,
    schemas
};
