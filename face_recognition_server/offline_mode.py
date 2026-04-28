"""
Offline Mode: Mock Supabase Client for when network is unavailable
Stores data in memory instead of calling Supabase API
"""

import json
from typing import Dict, List, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class MockSupabaseTable:
    """Mock Supabase table with in-memory storage"""
    
    def __init__(self, table_name: str):
        self.table_name = table_name
        self.data: Dict[str, Any] = {}
        logger.info(f"📦 Created mock table: {table_name}")
    
    def insert(self, record: Dict[str, Any]):
        """Insert a single record"""
        return MockQuery(self, 'insert', record)
    
    def select(self, *columns):
        """Select records"""
        return MockQuery(self, 'select', columns)
    
    def update(self, record: Dict[str, Any]):
        """Update a record"""
        return MockQuery(self, 'update', record)
    
    def delete(self):
        """Delete records"""
        return MockQuery(self, 'delete', None)
    
    def _store_record(self, record: Dict[str, Any]):
        """Store record in memory with ID as key"""
        record_id = record.get('id', str(len(self.data)))
        self.data[record_id] = record
        logger.debug(f"✅ Stored in {self.table_name}: {record_id}")
        return record
    
    def _get_all_records(self) -> List[Dict[str, Any]]:
        """Get all records"""
        return list(self.data.values())
    
    def _update_record(self, record: Dict[str, Any]):
        """Update existing record"""
        record_id = record.get('id')
        if record_id in self.data:
            self.data[record_id].update(record)
            logger.debug(f"✅ Updated in {self.table_name}: {record_id}")
        return record
    
    def _delete_all(self):
        """Delete all records"""
        count = len(self.data)
        self.data.clear()
        logger.debug(f"🗑️  Deleted {count} records from {self.table_name}")


class MockQuery:
    """Mock Supabase query builder"""
    
    def __init__(self, table: MockSupabaseTable, operation: str, data: Any):
        self.table = table
        self.operation = operation
        self.data = data
        self.filters: List[tuple] = []
    
    def eq(self, column: str, value: Any):
        """WHERE column = value"""
        self.filters.append(('eq', column, value))
        return self
    
    def execute(self):
        """Execute the query and return result"""
        try:
            if self.operation == 'insert':
                stored = self.table._store_record(self.data)
                return MockResponse(stored, 200)
            
            elif self.operation == 'select':
                records = self.table._get_all_records()
                
                # Apply filters
                for filter_type, column, value in self.filters:
                    if filter_type == 'eq':
                        records = [r for r in records if r.get(column) == value]
                
                return MockResponse(records, 200)
            
            elif self.operation == 'update':
                updated = self.table._update_record(self.data)
                return MockResponse(updated, 200)
            
            elif self.operation == 'delete':
                self.table._delete_all()
                return MockResponse([], 200)
            
        except Exception as e:
            logger.error(f"❌ Mock query error: {e}")
            return MockResponse(None, 500)


class MockResponse:
    """Mock Supabase response"""
    
    def __init__(self, data: Any, status_code: int):
        self.data = data
        self.status_code = status_code
    
    def __repr__(self):
        return f"MockResponse(status={self.status_code}, data={self.data})"


class OfflineSupabaseClient:
    """Mock Supabase client for offline mode"""
    
    def __init__(self):
        self.tables: Dict[str, MockSupabaseTable] = {}
        logger.info("🔌 Offline Mode Activated - Using in-memory storage")
    
    def table(self, table_name: str) -> MockSupabaseTable:
        """Get or create a table"""
        if table_name not in self.tables:
            self.tables[table_name] = MockSupabaseTable(table_name)
        return self.tables[table_name]
    
    def get_all_data(self) -> Dict[str, Any]:
        """Get all data from all tables (for debugging)"""
        return {
            name: table._get_all_records()
            for name, table in self.tables.items()
        }


def get_offline_client() -> OfflineSupabaseClient:
    """Factory function to get offline Supabase client"""
    return OfflineSupabaseClient()
