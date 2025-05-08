const Joi = require('joi');
const AppError = require('../utils/AppError');

// 请求验证中间件
const validator = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });

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
        username: Joi.string().trim().min(3).max(50).required()
            .messages({
                'string.min': '用户名至少需要3个字符',
                'string.max': '用户名最多50个字符',
                'any.required': '用户名不能为空'
            }),
        email: Joi.string().email().required()
            .messages({
                'string.email': '请输入有效的邮箱地址',
                'any.required': '邮箱不能为空'
            }),
        password: Joi.string().min(6).required()
            .messages({
                'string.min': '密码至少需要6个字符',
                'any.required': '密码不能为空'
            }),
        passwordConfirm: Joi.string().valid(Joi.ref('password')).required()
            .messages({
                'any.only': '两次输入的密码不一致',
                'any.required': '请确认密码'
            })
    }),

    // 用户登录验证
    userLogin: Joi.object({
        email: Joi.string().email().required()
            .messages({
                'string.email': '请输入有效的邮箱地址',
                'any.required': '邮箱不能为空'
            }),
        password: Joi.string().required()
            .messages({
                'any.required': '密码不能为空'
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
        tags: Joi.array().items(Joi.string())
    })
};

module.exports = {
    validate: validator,
    schemas
};