import React from 'react';
import { BrandLogo } from './BrandLogo';
import { VisitCounter } from './VisitCounter';

export const Footer: React.FC = () => (
  <footer className="bg-gradient-to-b from-blue-900 to-[#1a1c3d] text-white pt-12 sm:pt-16 pb-8 border-t-[8px] border-blue-800 font-sans">
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="grid md:grid-cols-3 gap-10 md:gap-12 items-start mb-12">
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="bg-white p-2 rounded-2xl w-[88px] h-[88px] shrink-0 flex items-center justify-center shadow-lg">
              <BrandLogo className="w-16 h-16" />
            </div>
            <div>
              <h3 className="font-black text-xl md:text-2xl uppercase leading-tight text-white mb-1">Trung tâm Ngoại ngữ Cô Phượng Uyên</h3>
              <p className="text-blue-200 font-bold text-xs uppercase tracking-wider">LEARN TODAY, BETTER TOMORROW 🌟</p>
            </div>
          </div>
          <p className="text-blue-100 text-sm md:text-base leading-relaxed italic">
            Truyền cảm hứng yêu thích tiếng Anh – Xây nền tảng vững chắc – Học hiệu quả – Hiểu sâu – Sử dụng thành thạo.
          </p>
        </div>

        <div className="space-y-6">
          <h4 className="font-black text-white text-lg uppercase tracking-widest flex items-center gap-3 border-l-4 border-blue-400 pl-3">
            <span className="text-red-400">📍</span> THÔNG TIN ĐÀO TẠO
          </h4>
          <ul className="space-y-6">
            <li className="flex items-start gap-4">
              <span className="text-2xl mt-1">🏛️</span>
              <div>
                <p className="font-bold text-blue-200 text-xs uppercase tracking-widest mb-1">GIÁM ĐỐC TRUNG TÂM:</p>
                <p className="font-bold text-white text-base">Võ Thùy Phượng Uyên</p>
              </div>
            </li>
            <li className="flex items-start gap-4">
              <span className="text-2xl mt-1">✨</span>
              <div>
                <p className="font-bold text-blue-200 text-xs uppercase tracking-widest mb-1">Phương châm:</p>
                <p className="font-bold text-white text-sm leading-relaxed">Học vững từ gốc – ứng dụng thực tế – tự tin hội nhập toàn cầu</p>
              </div>
            </li>
          </ul>
        </div>

        <div className="space-y-6">
          <h4 className="font-black text-white text-lg uppercase tracking-widest flex items-center gap-3 border-l-4 border-yellow-400 pl-3">
            <span className="text-yellow-400">✨</span> LIÊN HỆ ĐĂNG KÝ
          </h4>
          <div className="space-y-4">
            <a href="tel:0985846325" className="flex items-center gap-4 bg-white/5 hover:bg-white/10 border border-white/10 p-4 rounded-2xl transition-all group">
              <span className="text-3xl group-hover:scale-110 transition-transform">📱</span>
              <div>
                <p className="font-bold text-blue-200 text-[10px] uppercase tracking-widest mb-1">HOTLINE / ZALO CÔ PHƯỢNG UYÊN</p>
                <p className="font-black text-white text-xl">0985.846.325</p>
              </div>
            </a>
            <a href="https://www.facebook.com/profile.php?id=100045429101693" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-4 bg-white/5 hover:bg-white/10 border border-white/10 p-4 rounded-2xl transition-all group">
              <span className="text-3xl group-hover:scale-110 transition-transform">🌐</span>
              <div>
                <p className="font-bold text-blue-200 text-[10px] uppercase tracking-widest mb-1">FACEBOOK</p>
                <p className="font-bold text-white text-sm">Ghé thăm fanpage của Trung Tâm.</p>
              </div>
            </a>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-blue-200 text-sm font-medium text-center md:text-left">© {new Date().getFullYear()} Trung Tâm Ngoại Ngữ Cô Phượng Uyên. Learn today, better tomorrow.</p>
        <div className="bg-white/5 border border-white/10 px-5 py-2.5 rounded-full flex items-center gap-3">
          <span>👑</span>
          <span className="text-blue-100 text-sm font-bold">Chăm chỉ rèn luyện – Chinh phục tiếng Anh</span>
        </div>
      </div>
      <div className="mt-6 flex justify-center"><VisitCounter /></div>
    </div>
  </footer>
);
