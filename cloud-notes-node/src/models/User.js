const mongoose = require('mongoose');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, '用户名不能为空'],
        trim: true,
        minlength: [3, '用户名至少3个字符'],
        maxlength: [50, '用户名最多50个字符']
    },
    email: {
        type: String,
        // 邮箱可选
        unique: true,
        sparse: true, // 允许为空的情况下保持唯一性
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, '请输入有效的邮箱地址']
    },
    phone: {
        type: String,
        required: [true, '手机号不能为空'],
        unique: true,
        trim: true,
        match: [/^1[3-9]\d{9}$/, '请输入有效的手机号']
    },
    password: {
        type: String,
        required: [true, '密码不能为空'],
        minlength: [6, '密码至少6个字符'],
        select: false
    },
    avatar: {
        type: String,
        default: 'default-avatar.png'
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// 虚拟属性: 获取用户的所有笔记本
userSchema.virtual('notebooks', {
    ref: 'Notebook',
    localField: '_id',
    foreignField: 'userId'
});

// 保存前加密密码
userSchema.pre('save', async function(next) {
    // 只有密码被修改时才重新加密
    if (!this.isModified('password')) return next();

    try {
        // 使用scrypt替代bcrypt
        const salt = crypto.randomBytes(16).toString('hex');
        this.password = await new Promise((resolve, reject) => {
            crypto.scrypt(this.password, salt, 64, (err, derivedKey) => {
                if (err) reject(err);
                resolve(salt + ':' + derivedKey.toString('hex'));
            });
        });
        next();
    } catch (error) {
        next(error);
    }
});

// 比较密码
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        const [salt, key] = this.password.split(':');
        return await new Promise((resolve, reject) => {
            crypto.scrypt(candidatePassword, salt, 64, (err, derivedKey) => {
                if (err) reject(err);
                resolve(key === derivedKey.toString('hex'));
            });
        });
    } catch (error) {
        return false;
    }
};

// 更新时间
userSchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: Date.now() });
    next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;