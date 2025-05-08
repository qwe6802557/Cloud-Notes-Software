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
        phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required()
            .messages({
                'string.pattern.base': '请输入有效的手机号',
                'any.required': '手机号不能为空',
                'string.empty': '手机号不能为空'
            }),
        email: Joi.string().email().allow('', null)
            .messages({
                'string.email': '请输入有效的邮箱地址'
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
        verificationCode: Joi.string().length(6).required()
            .messages({
                'string.length': '验证码错误',
                'any.required': '验证码不能为空',
                'string.empty': '验证码不能为空'
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
    // 手机号+验证码登录验证
    phoneLogin: Joi.object({
        phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required()
            .messages({
                'string.pattern.base': '请输入有效的手机号',
                'any.required': '手机号不能为空',
                'string.empty': '手机号不能为空'
            }),
        smsCode: Joi.string().length(6).required()
            .messages({
                'string.length': '短信验证码必须是6位',
                'any.required': '短信验证码不能为空',
                'string.empty': '短信验证码不能为空'
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
        content: Joi.string().required()
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
        phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required()
            .messages({
                'string.pattern.base': '请输入有效的手机号',
                'any.required': '手机号不能为空',
                'string.empty': '手机号不能为空'
                // 坑点:
                // Joi 验证库对于“字段缺失”和“字段为空字符串”这两种情况，默认会触发不同的错误类型和消息
                // 不传 phone 字段: Joi 会触发 any.required 错误，为此已经配置了中文消息 "手机号不能为空"。
                // 传 phone 字段但值为空 (如 ?phone=): req.query.phone 会是一个空字符串 ""。对于一个 Joi.string().required() 类型的字段，空字符串默认是不被允许的（除非显式使用 .allow('')）。因此，Joi 会认为这是一个无效值。此时触发的默认错误消息是英文的，类似 "[field name]" is not allowed to be empty。
                // 为了使这两种情况都提示 "手机号不能为空"，需要在 schemas.sendVerificationCode 的 phone 字段的 .messages() 中，为“字符串为空”这种情况也指定中文提示。对应的 Joi 消息键是 string.empty
            })
    })
};

module.exports = {
    validate,
    schemas
};