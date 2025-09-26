# cors_config.py
from fastapi.middleware.cors import CORSMiddleware

def setup_cors(app):
    """
    Setup CORS configuration for production deployment
    """
    
    # Production CORS settings for Vercel + Google Cloud Run
    origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:4173",
        "https://your-vercel-app.vercel.app",  # เปลี่ยนเป็น domain จริงของ Vercel
        "https://*.vercel.app",  # Allow all Vercel subdomains
        # เพิ่ม domain อื่นๆ ที่จำเป็น
    ]
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=r"https://.*\.vercel\.app",  # Allow all Vercel apps
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=[
            "Accept",
            "Accept-Language",
            "Content-Language",
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "Origin",
            "Access-Control-Request-Method",
            "Access-Control-Request-Headers",
        ],
        expose_headers=["*"],
        max_age=86400,  # 24 hours
    )