import pandas as pd
import talib
import json
import sys
from datetime import datetime

# Simulator Configuration
INITIAL_BALANCE = 10000
STAKE_AMOUNT = 10

class BacktestEngine:
    def __init__(self, data_path):
        self.data_path = data_path
        self.balance = INITIAL_BALANCE
        self.positions = []
        self.trades = []
        self.df = None

    def load_data(self):
        try:
            print(f"Loading data from {self.data_path}...")
            # Assuming CSV with: time, price, bid, ask
            self.df = pd.read_csv(self.data_path)
            self.df['time'] = pd.to_datetime(self.df['time'])
            self.df.set_index('time', inplace=True)
            print(f"Loaded {len(self.df)} ticks.")
        except Exception as e:
            print(f"Error loading data: {e}")
            sys.exit(1)

    def add_indicators(self):
        # Match Logic from RiskEngine/Indicators.js
        # Example: SMA 14, RSI 14
        if self.df is None: return
        
        prices = self.df['price'].values
        self.df['sma_14'] = talib.SMA(prices, timeperiod=14)
        self.df['rsi_14'] = talib.RSI(prices, timeperiod=14)

    def run_simulation(self):
        print("Running simulation...")
        in_position = False
        entry_price = 0
        entry_time = None

        for index, row in self.df.iterrows():
            price = row['price']
            rsi = row['rsi_14']

            # Trading Logic (Simple Mean Reversion Example)
            # Buy if RSI < 30
            # Sell if RSI > 70
            
            if not in_position and rsi < 30:
                # BUY
                entry_price = price
                entry_time = index
                in_position = True
                self.trades.append({'type': 'BUY', 'price': price, 'time': str(index)})
            
            elif in_position and rsi > 70:
                # SELL (Close)
                pnl = (price - entry_price)  # Simplified 1:1 payout logic or price diff
                # For binary options it's different, but let's assume CFD style for backtest proof
                
                self.balance += pnl * STAKE_AMOUNT
                in_position = False
                self.trades.append({
                    'type': 'SELL', 
                    'price': price, 
                    'time': str(index), 
                    'pnl': pnl * STAKE_AMOUNT,
                    'balance': self.balance
                })

        print("Simulation complete.")

    def generate_report(self):
        total_trades = len([t for t in self.trades if t['type'] == 'SELL'])
        wins = len([t for t in self.trades if t.get('pnl', 0) > 0])
        
        report = {
            'initial_balance': INITIAL_BALANCE,
            'final_balance': self.balance,
            'total_trades': total_trades,
            'win_rate': (wins / total_trades * 100) if total_trades > 0 else 0,
            'trades': self.trades
        }
        
        print(json.dumps(report, indent=2))

if __name__ == "__main__":
    # Usage: python backtest.py <data_file.csv>
    if len(sys.argv) < 2:
        print("Usage: python backtest.py <data.csv>")
        # Create dummy data for demonstration if no arg
        df = pd.DataFrame({
            'time': pd.date_range(start='2024-01-01', periods=100, freq='1min'),
            'price': [100 + i%10 for i in range(100)]
        })
        df.to_csv('dummy_data.csv', index=False)
        engine = BacktestEngine('dummy_data.csv')
    else:
        engine = BacktestEngine(sys.argv[1])

    engine.load_data()
    engine.add_indicators()
    engine.run_simulation()
    engine.generate_report()
