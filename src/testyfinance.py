import yfinance as yf

# Choose a stock
stock = yf.Ticker("AAPL")

# Download historical data
data = stock.history(
    start="2020-01-01",
    end="2026-10-01",
    auto_adjust=False
)

# Display the data
print(data)

# Save to CSV
data.to_csv("apple_data.csv")
