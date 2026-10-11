import os

import yfinance as yf
from fastapi import FastAPI, HTTPException
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)


@app.get("/")
def home():
    return {"message": "API is working"}


@app.post("/prices")
def get_prices():
    try:
        data = yf.Ticker("AAPL").history(
            start="2020-01-01",
            end="2026-10-01",
            auto_adjust=False,
        )

        if data.empty:
            raise HTTPException(
                status_code=404,
                detail="No price data found",
            )

        data.index = data.index.strftime("%Y-%m-%d")
        data = data.reset_index()
        data.columns = [
            "date" if col == "Date" else col for col in data.columns
        ]

        # Create the table if it does not exist
        with engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS prices (
                    ticker VARCHAR(10) NOT NULL,
                    date DATE NOT NULL,
                    open DOUBLE PRECISION,
                    high DOUBLE PRECISION,
                    low DOUBLE PRECISION,
                    close DOUBLE PRECISION,
                    adjusted_close DOUBLE PRECISION,
                    volume BIGINT,
                    PRIMARY KEY (ticker, date)
                )
            """))

            # Insert or update historical prices
            for _, row in data.iterrows():
                connection.execute(
                    text("""
                        INSERT INTO prices (
                            ticker, date, open, high, low,
                            close, adjusted_close, volume
                        )
                        VALUES (
                            'AAPL', :date, :open, :high, :low,
                            :close, :adjusted_close, :volume
                        )
                        ON CONFLICT (ticker, date) DO UPDATE SET
                            open = EXCLUDED.open,
                            high = EXCLUDED.high,
                            low = EXCLUDED.low,
                            close = EXCLUDED.close,
                            adjusted_close = EXCLUDED.adjusted_close,
                            volume = EXCLUDED.volume
                    """),
                    {
                        "date": row["date"],
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "adjusted_close": float(row["Adj Close"]),
                        "volume": int(row["Volume"]),
                    },
                )

        # Return JSON
        prices = [
            {
                "date": row["date"],
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "adjusted_close": float(row["Adj Close"]),
                "volume": int(row["Volume"]),
            }
            for _, row in data.iterrows()
        ]

        return {
            "ticker": "AAPL",
            "start_date": "2020-01-01",
            "end_date": "2026-10-01",
            "interval": "1d",
            "count": len(prices),
            "prices": prices,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))