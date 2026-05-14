import request from '@/utils/request';

export const uploadNoteImage = (file, onUploadProgress) => {
    const formData = new FormData();

    formData.append('image', file);

    return request({
        url: '/uploads/notes',
        method: 'post',
        data: formData,
        onUploadProgress
    });
};
